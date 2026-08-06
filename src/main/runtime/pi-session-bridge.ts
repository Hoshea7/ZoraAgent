import type { AgentSessionEvent, AgentSessionEventListener, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ReasoningLevel, ConversationMessage } from "../../shared/zora";
import type { PiProviderConfig } from "./pi-provider-registry";
import type { RunLimits } from "../agent-profiles";
import { buildPiConversationHistory } from "./pi-conversation";
import { getZoraPluginPath } from "../skill-manager";
import { createPiMcpTools } from "./pi-mcp-bridge";
import { createPiTodoTool } from "./pi-todo-tool";

export interface PiSessionHandle {
  run(
    prompt: string,
    systemPrompt: string,
    dynamicContext: string,
    onEvent: (event: AgentSessionEvent) => void,
    reasoningLevel?: ReasoningLevel,
    images?: ImageContent[]
  ): Promise<void>;
  abort(): void;
  dispose(): void;
}

function toThinkingLevel(level: ReasoningLevel): "low" | "medium" | "high" | undefined {
  if (level === "off") return undefined;
  if (level === "max") return "high";
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

export class PiSessionBridge {
  private readonly agents = new Map<string, AgentSession>();

  async getOrCreateAgent(
    sessionId: string,
    providerConfig: PiProviderConfig,
    workingDirectory: string,
    limits: RunLimits,
    systemPrompt: string,
    conversationMessages: readonly ConversationMessage[],
    currentPrompt: string,
    extraTools?: ToolDefinition[]
  ): Promise<PiSessionHandle> {
    const existing = this.agents.get(sessionId);
    if (existing) {
      return this.createHandle(existing);
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
          maxTokens: 8192,
        },
      ],
    });

    const model = modelRuntime.getModel(providerConfig.providerId, providerConfig.model);
    if (!model) {
      throw new Error(`Model ${providerConfig.model} not found after provider registration`);
    }

    const sessionManager = mod.SessionManager.inMemory(workingDirectory);
    const settingsManager = mod.SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });

    const resourceLoader = new mod.DefaultResourceLoader({
      cwd: workingDirectory,
      agentDir: getZoraPluginPath(),
      settingsManager,
      systemPrompt,
      noExtensions: true,
    });
    await resourceLoader.reload();

    const mcpTools = await createPiMcpTools();
    const allTools = [...mcpTools, createPiTodoTool(), ...(extraTools ?? [])];

    const { session } = await mod.createAgentSession({
      cwd: workingDirectory,
      model,
      modelRuntime,
      thinkingLevel: toThinkingLevel(limits.reasoningLevel),
      resourceLoader,
      sessionManager,
      settingsManager,
      customTools: allTools,
    });

    // Enable all coding tools (read, bash, edit, write, grep, find, ls) + custom tools
    session.setActiveToolsByName([
      "read", "bash", "edit", "write", "grep", "find", "ls",
      ...allTools.map((t) => t.name),
    ]);

    const historicalMessages = buildPiConversationHistory(
      conversationMessages,
      currentPrompt,
      providerConfig
    );
    if (historicalMessages.length > 0) {
      session.agent.state.messages = historicalMessages;
    }

    this.agents.set(sessionId, session);
    return this.createHandle(session);
  }

  private createHandle(session: AgentSession): PiSessionHandle {
    return {
      run: async (prompt, _systemPrompt, dynamicContext, onEvent, _reasoningLevel, images) => {
        const unsubscribe = session.subscribe(onEvent as AgentSessionEventListener);
        try {
          const fullPrompt = dynamicContext.trim()
            ? `${dynamicContext}\n\n${prompt}`
            : prompt;
          await session.prompt(fullPrompt, images && images.length > 0 ? { images } : undefined);
          await session.waitForIdle();
        } finally {
          unsubscribe();
        }
      },
      abort: () => {
        void session.abort();
      },
      dispose: () => {
        session.dispose();
      },
    };
  }

  disposeAll(): void {
    for (const session of this.agents.values()) {
      session.dispose();
    }
    this.agents.clear();
  }
}
