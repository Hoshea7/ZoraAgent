import type { AgentSessionEvent, AgentSessionEventListener, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ReasoningLevel, ConversationMessage } from "../../shared/zora";
import type { PiProviderConfig } from "./pi-provider-registry";
import type { ModelTuning } from "../agent-profiles";
import type { RunBudgetGuard } from "./run-budget-guard";
import { buildPiConversationHistory } from "./pi-conversation";
import { getZoraPluginPath, GLOBAL_SKILLS_DIR } from "../skill-manager";
import { createPiMcpTools, disposePiMcpConnections } from "./pi-mcp-bridge";
import { createPiTodoTool } from "./pi-todo-tool";
import { createPiAskUserQuestionTool } from "./pi-ask-user-tool";
import { adaptToolGateToPiTools } from "./pi-tool-gate";
import type { ToolGate } from "./tool-gate";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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
  markUserMessageConsumed(userMessageId: string): void;
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
    // Warmup is best-effort; the real import in createTurn surfaces errors.
    warmupPromise = null;
  });
}

/** Pi SDK checkpoint 由 Pi Adapter 持有，不进入 Zora 产品会话元数据。 */
const PI_SESSION_DIR = path.join(ZORA_DIR, "runtime-sessions", "pi");
const ZORA_TURN_CURSOR = "zora.turn-cursor";

function findSessionFile(sessionDir: string): string | undefined {
  if (!existsSync(sessionDir)) return undefined;
  return readdirSync(sessionDir)
    .filter((entry) => entry.endsWith(".jsonl"))
    .map((entry) => path.join(sessionDir, entry))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
}

export interface PiTurnInput {
  sessionId: string;
  workspaceId: string;
  providerConfig: PiProviderConfig;
  workingDirectory: string;
  modelTuning: ModelTuning;
  systemPrompt: string;
  conversationMessages: readonly ConversationMessage[];
  currentPrompt: string;
  extraTools?: ToolDefinition[];
  toolGate: ToolGate;
}

export class PiSessionBridge {
  private readonly activeSessions = new Set<AgentSession>();

  constructor(private readonly sessionRoot = PI_SESSION_DIR) {}

  async createTurn(input: PiTurnInput): Promise<PiSessionHandle> {
    const {
      sessionId,
      workspaceId,
      providerConfig,
      workingDirectory,
      modelTuning,
      systemPrompt,
      conversationMessages,
      currentPrompt,
      extraTools,
      toolGate,
    } = input;

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
          input: ["text", "image"],
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

    const sessionDir = path.join(this.sessionRoot, workspaceId, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const requestedSessionFile = findSessionFile(sessionDir);
    let sessionManager = requestedSessionFile
      ? mod.SessionManager.open(requestedSessionFile, sessionDir, workingDirectory)
      : mod.SessionManager.create(workingDirectory, sessionDir, { id: sessionId });

    const currentUserMessage = [...conversationMessages]
      .reverse()
      .find((message) => message.role === "user" && message.text?.trim() === currentPrompt.trim());
    const historicalMessages = [...conversationMessages];
    if (currentUserMessage && historicalMessages.at(-1)?.id === currentUserMessage.id) {
      historicalMessages.pop();
    }

    const cursor = [...sessionManager.getEntries()]
      .reverse()
      .find((entry) => entry.type === "custom" && entry.customType === ZORA_TURN_CURSOR);
    const cursorUserId = cursor?.type === "custom"
      && typeof cursor.data === "object"
      && cursor.data !== null
      && "userMessageId" in cursor.data
      && typeof cursor.data.userMessageId === "string"
      ? cursor.data.userMessageId
      : undefined;

    if (requestedSessionFile && !cursorUserId) {
      // 没有 Zora cursor 的 checkpoint 无法判断与产品历史的同步位置，直接重建。
      // checkpoint 是 Runtime 派生数据，Zora 产品历史仍完整保留。
      rmSync(sessionDir, { recursive: true, force: true });
      mkdirSync(sessionDir, { recursive: true });
      sessionManager = mod.SessionManager.create(workingDirectory, sessionDir, { id: sessionId });
    }

    const cursorIndex = cursorUserId
      ? historicalMessages.findIndex((message) => message.id === cursorUserId)
      : -1;
    let messagesToImport = cursorIndex >= 0
      ? historicalMessages.slice(cursorIndex + 1)
      : historicalMessages;
    // cursor 指向上一次由 Pi 原生执行的用户消息，紧随其后的 assistant turn
    // 已经存在于 Pi transcript，无需再次投影。
    if (cursorIndex >= 0 && messagesToImport[0]?.role === "assistant") {
      messagesToImport = messagesToImport.slice(1);
    }
    for (const message of buildPiConversationHistory(messagesToImport, currentPrompt, providerConfig)) {
      sessionManager.appendMessage(message);
    }
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
    const customTools = [
      ...mcpTools,
      createPiTodoTool(),
      createPiAskUserQuestionTool(toolGate),
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
      toolGate
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

    this.activeSessions.add(session);
    return this.createHandle(session, currentUserMessage?.id);
  }

  private createHandle(session: AgentSession, currentUserMessageId?: string): PiSessionHandle {
    const pendingSteeringMessages: string[] = [];
    const existingBeforeToolCall = session.agent.beforeToolCall;
    session.agent.beforeToolCall = async (context, signal) => {
      const existingResult = await existingBeforeToolCall?.(context, signal);
      if (existingResult?.block) {
        return existingResult;
      }
      if (pendingSteeringMessages.length > 0) {
        return {
          block: true,
          reason: "用户发送了新的引导消息，当前工具调用已跳过。",
        };
      }
      return existingResult;
    };

    let initialUserMessageStarted = false;
    return {
      run: async (prompt, _systemPrompt, dynamicContext, onEvent, _reasoningLevel, images, budgetGuard) => {
        const unsubscribe = session.subscribe(((event: AgentSessionEvent) => {
          if (event.type === "message_start" && event.message.role === "user") {
            if (!initialUserMessageStarted) {
              initialUserMessageStarted = true;
            } else if (pendingSteeringMessages.length > 0) {
              pendingSteeringMessages.shift();
            }
          }
          onEvent(event);
        }) as AgentSessionEventListener);
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
          if (currentUserMessageId) {
            session.sessionManager.appendCustomEntry(ZORA_TURN_CURSOR, {
              userMessageId: currentUserMessageId,
            });
          }
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
      steer: async (text, images) => {
        pendingSteeringMessages.push(text);
        try {
          await session.steer(text, images);
        } catch (error) {
          pendingSteeringMessages.pop();
          throw error;
        }
      },
      followUp: (text, images) => session.followUp(text, images),
      markUserMessageConsumed: (userMessageId) => {
        session.sessionManager.appendCustomEntry(ZORA_TURN_CURSOR, {
          userMessageId,
        });
      },
      get isStreaming() { return session.isStreaming; },
      abort: async () => {
        pendingSteeringMessages.length = 0;
        session.clearQueue();
        session.abortCompaction();
        await session.abort();
      },
      dispose: () => {
        session.dispose();
        this.activeSessions.delete(session);
      },
    };
  }

  disposeAll(): void {
    for (const session of this.activeSessions) {
      session.dispose();
    }
    this.activeSessions.clear();
    disposePiMcpConnections();
  }

  deleteCheckpoint(sessionId: string, workspaceId: string): void {
    rmSync(path.join(this.sessionRoot, workspaceId, sessionId), {
      recursive: true,
      force: true,
    });
  }
}
