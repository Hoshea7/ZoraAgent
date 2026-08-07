import type { AgentSessionEvent, AgentSessionEventListener, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ReasoningLevel, ConversationMessage } from "../../shared/zora";
import type { PiProviderConfig } from "./pi-provider-registry";
import type { ModelTuning } from "../agent-profiles";
import type { RunBudgetGuard } from "./run-budget-guard";
import { buildPiConversationHistory } from "./pi-conversation";
import { getZoraPluginPath, GLOBAL_SKILLS_DIR } from "../skill-manager";
import { createPiMcpTools } from "./pi-mcp-bridge";
import { createPiTodoTool } from "./pi-todo-tool";
import { createPiAskUserQuestionTool } from "./pi-ask-user-tool";
import { adaptToolGateToPiTools } from "./pi-tool-gate";
import type { ToolGate } from "./tool-gate";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { ZORA_DIR } from "../utils/fs";

export interface PiSessionHandle {
  run(
    prompt: string,
    systemPrompt: string,
    dynamicContext: string,
    onEvent: (event: AgentSessionEvent) => void,
    reasoningLevel?: ReasoningLevel,
    images?: ImageContent[],
    budgetGuard?: RunBudgetGuard
  ): Promise<void>;
  steer(text: string, images?: ImageContent[]): Promise<void>;
  followUp(text: string, images?: ImageContent[]): Promise<void>;
  readonly isStreaming: boolean;
  abort(): Promise<void>;
  dispose(): void;
}

function toThinkingLevel(level: ReasoningLevel): "high" | "max" | undefined {
  if (level === "off") return undefined;
  return level;
}

type AgentSession = import("@earendil-works/pi-coding-agent").AgentSession;

let warmupPromise: Promise<unknown> | null = null;

/**
 * Preload the pi-coding-agent module graph in the background so the first
 * Pi session does not block the main process on a cold require() of ~500
 * modules. Safe to call multiple times; only the first call does work.
 */
export function warmupPiRuntime(): void {
  warmupPromise ??= import("@earendil-works/pi-coding-agent").catch(() => {
    // Warmup is best-effort; the real import in getOrCreateAgent surfaces errors.
    warmupPromise = null;
  });
}

/**
 * Pi session 会跨轮复用，但 ToolGate 属于单次运行。用可替换代理持有当前运行的 Gate，
 * 避免旧运行的审批回调泄漏到新一轮。
 *
 * 缺少 Gate 时一律拒绝（fail-closed）：授权缺失必须表现为明确失败，而不是静默放行。
 */
class MutableToolGate implements ToolGate {
  constructor(private current: ToolGate) {}

  setCurrent(gate: ToolGate): void {
    this.current = gate;
  }

  authorize(req: Parameters<ToolGate["authorize"]>[0]) {
    return this.current.authorize(req);
  }

  ask(req: Parameters<ToolGate["ask"]>[0]) {
    return this.current.ask(req);
  }
}

interface PiSessionEntry {
  session: AgentSession;
  toolGate: MutableToolGate;
}

/** Pi SDK 会话文件存储目录。 */
const PI_SESSION_DIR = path.join(ZORA_DIR, "pi-sessions");

function findSessionFile(sessionDir: string, sdkSessionId: string): string | undefined {
  if (!existsSync(sessionDir)) return undefined;
  for (const entry of readdirSync(sessionDir)) {
    if (entry.endsWith(".jsonl") && entry.includes(sdkSessionId)) {
      return path.join(sessionDir, entry);
    }
  }
  return undefined;
}

export interface PiSessionResumeOptions {
  /** 已有的 Pi SDK session ID，用于恢复引擎 transcript。 */
  sdkSessionId?: string;
  /** 已知的会话文件路径，优先于目录扫描。 */
  piSessionFile?: string;
  /** 引擎 session 创建/恢复后回调，用于产品层持久化。 */
  onSessionId?: (sdkSessionId: string, piSessionFile?: string) => void;
}

export class PiSessionBridge {
  private readonly agents = new Map<string, PiSessionEntry>();

  async getOrCreateAgent(
    sessionId: string,
    providerConfig: PiProviderConfig,
    workingDirectory: string,
    modelTuning: ModelTuning,
    systemPrompt: string,
    conversationMessages: readonly ConversationMessage[],
    currentPrompt: string,
    extraTools?: ToolDefinition[],
    toolGate?: ToolGate,
    resumeOptions?: PiSessionResumeOptions
  ): Promise<PiSessionHandle> {
    // 授权是安全边界：缺 Gate 时必须明确失败，不得静默放行。无人值守场景由
    // 调用方传入 createUnattendedToolGate() 显式声明。
    if (!toolGate) {
      throw new Error("Pi session 缺少 ToolGate，拒绝创建无授权会话。");
    }

    const existing = this.agents.get(sessionId);
    if (existing) {
      existing.toolGate.setCurrent(toolGate);
      return this.createHandle(existing.session);
    }

    const mod = await import("@earendil-works/pi-coding-agent");

    const modelRuntime = await mod.ModelRuntime.create({ allowModelNetwork: false });
    modelRuntime.registerProvider(providerConfig.providerId, {
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      api: providerConfig.api,
      models: [
        {
          id: providerConfig.model,
          name: providerConfig.model,
          api: providerConfig.api,
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000,
          maxTokens: modelTuning.maxOutputTokens,
          // Some Anthropic-compatible endpoints (e.g. Volc Agent Plan) never emit
          // thinking signatures. Without this flag pi-ai replays prior thinking
          // blocks as plain text, and the model starts mimicking that pattern:
          // reasoning leaks into body text from the 3rd tool-call turn onward.
          compat: { allowEmptySignature: true },
        },
      ],
    });

    const model = modelRuntime.getModel(providerConfig.providerId, providerConfig.model);
    if (!model) {
      throw new Error(`Model ${providerConfig.model} not found after provider registration`);
    }

    const sessionManager = (() => {
      // 优先恢复已有的磁盘会话（保留 compaction 摘要、tool results 等引擎状态）。
      // 找不到则新建并落盘。
      if (resumeOptions?.sdkSessionId) {
        const filePath = resumeOptions.piSessionFile
          ?? findSessionFile(PI_SESSION_DIR, resumeOptions.sdkSessionId);
        if (filePath && existsSync(filePath)) {
          return mod.SessionManager.open(filePath, PI_SESSION_DIR, workingDirectory);
        }
      }
      if (!existsSync(PI_SESSION_DIR)) {
        mkdirSync(PI_SESSION_DIR, { recursive: true });
      }
      return mod.SessionManager.create(workingDirectory, PI_SESSION_DIR);
    })();
    const isResumed = resumeOptions?.sdkSessionId != null
      && sessionManager.getSessionFile() != null
      && existsSync(sessionManager.getSessionFile()!);
    const settingsManager = mod.SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });
    const zoraSkills = mod.loadSkills({
      cwd: workingDirectory,
      agentDir: getZoraPluginPath(),
      skillPaths: [GLOBAL_SKILLS_DIR],
      includeDefaults: false,
    });

    const resourceLoader = new mod.DefaultResourceLoader({
      cwd: workingDirectory,
      agentDir: getZoraPluginPath(),
      settingsManager,
      systemPrompt,
      noExtensions: true,
      // Extensions 保持关闭；只通过公开资源加载钩子注入 Zora 管理的 Skills。
      noSkills: true,
      skillsOverride: () => zoraSkills,
    });
    await resourceLoader.reload();

    const mcpTools = await createPiMcpTools();
    const mutableToolGate = new MutableToolGate(toolGate);
    const customTools = [
      ...mcpTools,
      createPiTodoTool(),
      createPiAskUserQuestionTool(mutableToolGate),
      ...(extraTools ?? []),
    ];
    const codingTools = [
      ...mod.createCodingTools(workingDirectory),
      mod.createGrepTool(workingDirectory),
      mod.createFindTool(workingDirectory),
      mod.createLsTool(workingDirectory),
    ] as unknown as ToolDefinition[];
    const allTools = adaptToolGateToPiTools(
      [...codingTools, ...customTools],
      mutableToolGate
    );

    const { session } = await mod.createAgentSession({
      cwd: workingDirectory,
      model,
      modelRuntime,
      thinkingLevel: toThinkingLevel(modelTuning.reasoningLevel),
      resourceLoader,
      sessionManager,
      settingsManager,
      customTools: allTools,
    });

    // 以同名 custom tool 覆盖内置实现，确保编码工具也经过授权包装。
    session.setActiveToolsByName(allTools.map((tool) => tool.name));

    // 磁盘恢复的会话已拥有完整 transcript，不需要从产品层重灌历史消息。
    // 只有全新创建的会话才需要用产品层的对话历史来初始化上下文。
    if (!isResumed) {
      const historicalMessages = buildPiConversationHistory(
        conversationMessages,
        currentPrompt,
        providerConfig
      );
      if (historicalMessages.length > 0) {
        session.agent.state.messages = historicalMessages;
      }
    }

    // 回调产品层持久化 session 标识，以便下次启动时恢复。
    resumeOptions?.onSessionId?.(
      sessionManager.getSessionId(),
      sessionManager.getSessionFile() ?? undefined
    );

    this.agents.set(sessionId, { session, toolGate: mutableToolGate });
    return this.createHandle(session);
  }

  private createHandle(session: AgentSession): PiSessionHandle {
    return {
      run: async (prompt, _systemPrompt, dynamicContext, onEvent, _reasoningLevel, images, budgetGuard) => {
        const unsubscribe = session.subscribe(onEvent as AgentSessionEventListener);
        // 用公开的 turn_end 事件记账并主动中止。Pi 的 shouldStopAfterTurn 只存在于
        // 私有 loop 配置里，给私有 API 打补丁会在 SDK 改名时静默失效——那比没有护栏更危险。
        const unsubscribeBudget = budgetGuard
          ? session.subscribe(((event: AgentSessionEvent) => {
              if (event.type === "turn_end" && budgetGuard.shouldStopAfterTurn()) {
                void session.abort();
              }
            }) as AgentSessionEventListener)
          : undefined;
        try {
          const fullPrompt = dynamicContext.trim()
            ? `${dynamicContext}\n\n${prompt}`
            : prompt;
          await session.prompt(fullPrompt, images && images.length > 0 ? { images } : undefined);
          await session.waitForIdle();
        } finally {
          unsubscribeBudget?.();
          unsubscribe();
        }
      },
      steer: (text, images) => session.steer(text, images),
      followUp: (text, images) => session.followUp(text, images),
      get isStreaming() { return session.isStreaming; },
      abort: async () => { await session.abort(); },
      dispose: () => {
        session.dispose();
      },
    };
  }

  disposeAll(): void {
    for (const { session } of this.agents.values()) {
      session.dispose();
    }
    this.agents.clear();
  }
}
