import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  StreamFn,
} from "@earendil-works/pi-agent-core";
import type { Message, Model } from "@earendil-works/pi-ai";
import type { PiProviderConfig } from "./pi-provider-registry";
import type { PiTurnGuard } from "./pi-runtime-guard";
import type { HarnessLimits } from "../agent-profiles";
import {
  authorizePiTools,
  createPiTools,
  type PiToolAuthorizer,
} from "./pi-tools";

export interface PiSessionHandle {
  replaceHistory(messages: AgentMessage[]): void;
  run(
    prompt: string,
    systemPrompt: string,
    dynamicContext: string,
    onEvent: (event: AgentEvent) => void,
    turnGuard: PiTurnGuard,
    authorizeTool?: PiToolAuthorizer
  ): Promise<void>;
  abort(): void;
  dispose(): void;
}

export type PiSessionFactory = (
  providerConfig: PiProviderConfig,
  workingDirectory: string,
  limits: HarnessLimits
) => Promise<PiSessionHandle>;

function buildPiModel(
  config: PiProviderConfig,
  limits: HarnessLimits
): Model<any> {
  return {
    id: config.model,
    name: config.model,
    api: config.api,
    provider: config.providerId,
    baseUrl: config.baseUrl,
    reasoning: limits.reasoningEffort !== "none",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: limits.maxOutputTokens,
  };
}

class PiAgentSession implements PiSessionHandle {
  private messages: AgentMessage[] = [];
  private activeController: AbortController | null = null;

  constructor(
    private readonly config: PiProviderConfig,
    private readonly model: Model<any>,
    private readonly tools: AgentTool<any>[],
    private readonly runAgentLoop: typeof import("@earendil-works/pi-agent-core").runAgentLoop,
    private readonly streamFn: StreamFn
  ) {}

  replaceHistory(messages: AgentMessage[]): void {
    if (this.activeController) {
      throw new Error("Cannot replace Pi history while the session is running.");
    }
    this.messages = [...messages];
  }

  async run(
    prompt: string,
    systemPrompt: string,
    dynamicContext: string,
    onEvent: (event: AgentEvent) => void,
    turnGuard: PiTurnGuard,
    authorizeTool?: PiToolAuthorizer
  ): Promise<void> {
    if (this.activeController) {
      throw new Error("Pi agent is already processing this session.");
    }

    const controller = new AbortController();
    this.activeController = controller;
    turnGuard.reset();

    const userMessage: Message = {
      role: "user",
      content: dynamicContext.trim() ? `${dynamicContext}\n\n${prompt}` : prompt,
      timestamp: Date.now(),
    };

    try {
      const newMessages = await this.runAgentLoop(
        [userMessage],
        {
          systemPrompt,
          messages: this.messages,
          tools: authorizeTool
            ? authorizePiTools(this.tools, authorizeTool)
            : this.tools,
        },
        {
          model: this.model,
          convertToLlm: (messages) => messages as Message[],
          getApiKey: () => this.config.apiKey,
          shouldStopAfterTurn: turnGuard.shouldStopAfterTurn,
        },
        onEvent,
        controller.signal,
        this.streamFn
      );
      this.messages.push(...newMessages);
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
      }
    }
  }

  abort(): void {
    this.activeController?.abort();
  }

  dispose(): void {
    this.abort();
    this.messages = [];
  }
}

async function createPiSession(
  config: PiProviderConfig,
  workingDirectory: string,
  limits: HarnessLimits
): Promise<PiSessionHandle> {
  const [{ runAgentLoop }, tools, apiModule] = await Promise.all([
    import("@earendil-works/pi-agent-core"),
    createPiTools(workingDirectory),
    config.api === "anthropic-messages"
      ? import("@earendil-works/pi-ai/api/anthropic-messages")
      : import("@earendil-works/pi-ai/api/openai-completions"),
  ]);

  return new PiAgentSession(
    config,
    buildPiModel(config, limits),
    tools,
    runAgentLoop,
    apiModule.streamSimple as StreamFn
  );
}

function sessionIdentity(
  config: PiProviderConfig,
  workingDirectory: string,
  limits: HarnessLimits
): string {
  return JSON.stringify([
    config.api,
    config.baseUrl,
    config.apiKey,
    config.model,
    config.providerId,
    workingDirectory,
    limits.maxOutputTokens,
    limits.reasoningEffort,
  ]);
}

interface SessionEntry {
  identity: string;
  handle: Promise<PiSessionHandle>;
  resolved?: PiSessionHandle;
}

export class PiSessionBridge {
  private readonly agents = new Map<string, SessionEntry>();

  constructor(private readonly factory: PiSessionFactory = createPiSession) {}

  async getOrCreateAgent(
    sessionId: string,
    providerConfig: PiProviderConfig,
    workingDirectory: string,
    limits: HarnessLimits
  ): Promise<PiSessionHandle> {
    const identity = sessionIdentity(providerConfig, workingDirectory, limits);
    const existing = this.agents.get(sessionId);
    if (existing?.identity === identity) {
      return existing.handle;
    }
    if (existing) {
      if (existing.resolved) {
        existing.resolved.dispose();
      } else {
        void existing.handle
          .then((handle) => handle.dispose())
          .catch(() => undefined);
      }
    }

    const handle = this.factory(providerConfig, workingDirectory, limits);
    const entry: SessionEntry = { identity, handle };
    void handle
      .then((resolved) => {
        entry.resolved = resolved;
      })
      .catch(() => {
        if (this.agents.get(sessionId) === entry) {
          this.agents.delete(sessionId);
        }
      });
    this.agents.set(sessionId, entry);
    return handle;
  }

  disposeAgent(sessionId: string): void {
    const entry = this.agents.get(sessionId);
    this.agents.delete(sessionId);
    if (entry?.resolved) {
      entry.resolved.abort();
      entry.resolved.dispose();
    } else if (entry) {
      void entry.handle
        .then((handle) => {
          handle.abort();
          handle.dispose();
        })
        .catch(() => undefined);
    }
  }

  dispose(): void {
    for (const sessionId of this.agents.keys()) {
      this.disposeAgent(sessionId);
    }
  }
}
