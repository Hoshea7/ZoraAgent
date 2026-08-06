import { getErrorMessage, logSystemEvent } from "../system-log";
import { createCanUseTool } from "../hitl";
import {
  PiEventMapper,
  PI_TOOL_NAME_MAP,
} from "./pi-event-mapper";
import { buildPiConversationHistory } from "./pi-conversation";
import { buildPiProvider } from "./pi-provider-registry";
import { createTurnGuard } from "./pi-runtime-guard";
import { PiSessionBridge } from "./pi-session-bridge";
import type { PiToolAuthorizer } from "./pi-tools";
import type {
  RuntimeAdapter,
  RuntimeStartInput,
  RuntimeQueuedMessage,
  RuntimeRunHandle,
} from "./types";
import { RuntimeNotAvailableError } from "./types";

interface PiRuntimeAdapterOptions {
  sessionBridge?: PiSessionBridge;
}

export class PiRuntimeAdapter implements RuntimeAdapter {
  readonly type = "pi" as const;
  private readonly sessionBridge: PiSessionBridge;

  constructor(options: PiRuntimeAdapterOptions = {}) {
    this.sessionBridge = options.sessionBridge ?? new PiSessionBridge();
  }

  start(input: RuntimeStartInput): RuntimeRunHandle {
    let activeAgent: Awaited<ReturnType<PiSessionBridge["getOrCreateAgent"]>> | null = null;
    let stopped = false;
    const queuedMessages: RuntimeQueuedMessage[] = [];

    const completion = this.run(input, queuedMessages, (agent) => {
      activeAgent = agent;
      if (stopped) agent.abort();
    }, () => stopped);

    return {
      completion,
      abort: async () => {
        stopped = true;
        queuedMessages.length = 0;
        activeAgent?.abort();
      },
      enqueue: async (message) => {
        if (stopped) {
          throw new Error("会话已停止，无法追加消息");
        }
        queuedMessages.push(message);
      },
    };
  }

  private async run(
    input: RuntimeStartInput,
    queuedMessages: RuntimeQueuedMessage[],
    onAgentReady: (agent: Awaited<ReturnType<PiSessionBridge["getOrCreateAgent"]>>) => void,
    isStopped: () => boolean
  ): Promise<{ status: "completed" | "stopped" }> {
    const startedAt = Date.now();
    input.forwardEvent({
      type: "agent_status",
      status: "started",
      source: input.source,
    });
    logSystemEvent(
      "agent",
      "pi-runtime",
      "query:start",
      "Pi Runtime 请求开始",
      {
        sessionId: input.harness.sessionId,
        workspaceId: input.harness.workspaceId,
        providerId: input.target.provider.id,
        modelId: input.target.modelId,
      }
    );

    try {
      const providerConfig = buildPiProvider(input.target);
      let agent;
      try {
        agent = await this.sessionBridge.getOrCreateAgent(
          input.harness.sessionId,
          providerConfig,
          input.harness.workspace.cwd,
          input.harness.limits
        );
        onAgentReady(agent);
        agent.replaceHistory(
          buildPiConversationHistory(
            input.harness.conversation.messages,
            input.harness.prompt.user,
            providerConfig
          )
        );
      } catch (error) {
        logSystemEvent(
          "agent",
          "pi-runtime",
          "init:error",
          "Pi Runtime 初始化失败",
          {
            sessionId: input.harness.sessionId,
            providerId: input.target.provider.id,
            modelId: input.target.modelId,
            error: getErrorMessage(error),
          },
          { level: "error" }
        );
        throw new RuntimeNotAvailableError(
          "pi",
          "runtime_initialization_failed"
        );
      }

      logSystemEvent(
        "agent",
        "pi-runtime",
        "init:done",
        "Pi Runtime 初始化完成",
        {
          sessionId: input.harness.sessionId,
          elapsedMs: Date.now() - startedAt,
        }
      );

      const turnGuard = createTurnGuard(input.harness.limits.maxTurns);
      const authorizeTool = this.createToolAuthorizer(input);
      const eventMapper = new PiEventMapper();
      const forwardPiEvent = (event: Parameters<PiEventMapper["map"]>[0]) => {
          const mapped = eventMapper.map(event);
          if (!mapped) {
            return;
          }
          if (mapped.type === "agent_error") {
            logSystemEvent(
              "agent",
              "pi-runtime",
              "provider:error",
              "Pi Provider 返回错误",
              {
                sessionId: input.harness.sessionId,
                providerId: input.target.provider.id,
                modelId: input.target.modelId,
                error: mapped.error,
              },
              { level: "error" }
            );
          }
          input.forwardEvent(mapped);
      };

      await agent.run(
        input.harness.prompt.user,
        input.harness.prompt.system,
        input.harness.prompt.dynamicContext,
        forwardPiEvent,
        turnGuard,
        authorizeTool
      );
      while (!isStopped() && queuedMessages.length > 0) {
        const message = queuedMessages.shift();
        if (!message) continue;
        await agent.run(
          message.text,
          input.harness.prompt.system,
          input.harness.prompt.dynamicContext,
          forwardPiEvent,
          createTurnGuard(input.harness.limits.maxTurns),
          authorizeTool
        );
      }

      logSystemEvent(
        "agent",
        "pi-runtime",
        "query:done",
        "Pi Runtime 请求完成",
        {
          sessionId: input.harness.sessionId,
          providerId: input.target.provider.id,
          modelId: input.target.modelId,
          elapsedMs: Date.now() - startedAt,
        }
      );
      return { status: isStopped() ? "stopped" : "completed" };
    } catch (error) {
      if (isStopped()) {
        return { status: "stopped" };
      }
      if (!(error instanceof RuntimeNotAvailableError)) {
        const message = getErrorMessage(error);
        logSystemEvent(
          "agent",
          "pi-runtime",
          "query:error",
          "Pi Runtime 请求失败",
          {
            sessionId: input.harness.sessionId,
            providerId: input.target.provider.id,
            modelId: input.target.modelId,
            elapsedMs: Date.now() - startedAt,
            error: message,
          },
          { level: "error" }
        );
        input.forwardEvent({ type: "agent_error", error: message });
      }
      throw error;
    } finally {
      input.forwardEvent({
        type: "agent_status",
        status: isStopped() ? "stopped" : "finished",
        source: input.source,
      });
    }
  }

  private createToolAuthorizer(
    input: RuntimeStartInput
  ): PiToolAuthorizer | undefined {
    if (input.harness.permissions.mode === "unattended") {
      return undefined;
    }

    const canUseTool = createCanUseTool(
      input.forwardEvent,
      input.harness.sessionId
    );
    return ({ toolCallId, toolName, input: toolInput, signal }) =>
      canUseTool(
        PI_TOOL_NAME_MAP[toolName.toLowerCase()] ?? toolName,
        toolInput,
        { signal, toolUseID: toolCallId }
      );
  }

  dispose(): void {
    this.sessionBridge.dispose();
  }
}
