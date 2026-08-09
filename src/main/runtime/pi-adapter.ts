import { getErrorMessage, logSystemEvent } from "../system-log";
import { resolveAttachmentContent } from "../attachment-handler";
import { PiEventMapper } from "./pi-event-mapper";
import { buildPiProvider } from "./pi-provider-registry";
import { PiSessionBridge } from "./pi-session-bridge";
import { createRunBudgetGuard } from "./run-budget-guard";
import { createUnattendedToolGate, type ToolGate } from "./tool-gate";
import type {
  AgentRuntimeAdapter,
  AgentRuntimeInput,
  AgentRuntimeQueuedMessage,
  AgentRuntimeHandle,
} from "./types";
import { AgentRuntimeNotAvailableError } from "./types";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { FileAttachment } from "../../shared/zora";

function preparePiQueuedContent(
  text: string,
  attachments: FileAttachment[] | undefined
): { text: string; images?: ImageContent[] } {
  const content = resolveAttachmentContent(attachments ?? []);
  const images = content
    .filter((block) => block.type === "image")
    .map((block) => ({
      type: "image" as const,
      data: block.data,
      mimeType: block.mimeType,
    }));
  const textPrefix = content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");

  return {
    text: textPrefix ? `${textPrefix}\n\n${text}` : text,
    images: images.length > 0 ? images : undefined,
  };
}

interface PiAgentRuntimeAdapterOptions {
  sessionBridge?: PiSessionBridge;
}

export class PiAgentRuntimeAdapter implements AgentRuntimeAdapter {
  readonly type = "pi" as const;
  private readonly sessionBridge: PiSessionBridge;

  constructor(options: PiAgentRuntimeAdapterOptions = {}) {
    this.sessionBridge = options.sessionBridge ?? new PiSessionBridge();
  }

  start(input: AgentRuntimeInput): AgentRuntimeHandle {
    let activeHandle: Awaited<ReturnType<PiSessionBridge["createTurn"]>> | null = null;
    let stopped = false;
    const queuedMessages: AgentRuntimeQueuedMessage[] = [];
    const queuedMessageIds = new Set<string>();

    const completion = this.run(input, queuedMessages, (handle) => {
      activeHandle = handle;
    }, () => stopped);

    return {
      completion,
      abort: async () => {
        stopped = true;
        queuedMessages.length = 0;
        queuedMessageIds.clear();
        if (activeHandle) await activeHandle.abort();
      },
      enqueue: async (message) => {
        if (stopped) {
          throw new Error("会话已停止，无法追加消息");
        }
        if (queuedMessageIds.has(message.id)) {
          return;
        }
        queuedMessageIds.add(message.id);
        if (!activeHandle) {
          queuedMessages.push(message);
          return;
        }
        try {
          const content = preparePiQueuedContent(message.text, message.attachments);
          if (activeHandle.isStreaming) {
            await activeHandle.steer(content.text, content.images);
          } else {
            await activeHandle.followUp(content.text, content.images);
          }
          activeHandle.markUserMessageAccepted(`user-${message.id}`);
          input.forwardEvent({ type: "queued_message_accepted", uuid: message.id });
        } catch (error) {
          queuedMessageIds.delete(message.id);
          throw error;
        }
      },
    };
  }

  private async run(
    input: AgentRuntimeInput,
    queuedMessages: AgentRuntimeQueuedMessage[],
    onAgentReady: (handle: Awaited<ReturnType<PiSessionBridge["createTurn"]>>) => void,
    isStopped: () => boolean
  ): Promise<{ status: "completed" | "stopped" }> {
    const startedAt = Date.now();
    let sessionHandle: Awaited<ReturnType<PiSessionBridge["createTurn"]>> | null = null;
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
      try {
        sessionHandle = await this.sessionBridge.createTurn({
          sessionId: input.harness.sessionId,
          workspaceId: input.harness.workspaceId,
          providerConfig,
          workingDirectory: input.harness.workspace.cwd,
          modelTuning: input.harness.model,
          systemPrompt: input.harness.prompt.system,
          conversationMessages: input.harness.conversation.messages,
          currentPrompt: input.harness.prompt.user,
          extraTools: [],
          toolGate: this.createToolGate(input),
        });
        onAgentReady(sessionHandle);
        if (isStopped()) {
          return { status: "stopped" };
        }
        for (const message of queuedMessages.splice(0)) {
          const content = preparePiQueuedContent(message.text, message.attachments);
          await sessionHandle.followUp(content.text, content.images);
          if (isStopped()) {
            return { status: "stopped" };
          }
          sessionHandle.markUserMessageAccepted(`user-${message.id}`);
          input.forwardEvent({ type: "queued_message_accepted", uuid: message.id });
        }
      } catch (error) {
        if (isStopped()) {
          return { status: "stopped" };
        }
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
        throw new AgentRuntimeNotAvailableError("pi", "runtime_initialization_failed");
      }

      logSystemEvent(
        "agent",
        "pi-runtime",
        "init:done",
        "Pi Runtime 初始化完成",
        { sessionId: input.harness.sessionId, elapsedMs: Date.now() - startedAt }
      );

      const budgetGuard = createRunBudgetGuard(input.harness.budget);
      const eventMapper = new PiEventMapper();
      const forwardPiEvent = (event: Parameters<PiEventMapper["map"]>[0]) => {
        const mapped = eventMapper.map(event);
        if (!mapped) return;
        if (mapped.type === "agent_error") {
          logSystemEvent(
            "agent", "pi-runtime", "provider:error", "Pi Provider 返回错误",
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

      const attachmentContent = resolveAttachmentContent(input.attachments ?? []);
      const images: ImageContent[] = attachmentContent
        .filter((block) => block.type === "image")
        .map((block) => ({
          type: "image",
          data: block.data,
          mimeType: block.mimeType,
        }));
      const textPrefix = attachmentContent
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n\n");
      const userPrompt = textPrefix ? `${textPrefix}\n\n${input.harness.prompt.user}` : input.harness.prompt.user;

      if (isStopped()) {
        return { status: "stopped" };
      }
      await sessionHandle.run(
        userPrompt,
        input.harness.prompt.system,
        input.harness.prompt.dynamicContext,
        forwardPiEvent,
        input.harness.model.reasoningLevel,
        images.length > 0 ? images : undefined,
        budgetGuard
      );

      logSystemEvent(
        "agent", "pi-runtime", "query:done", "Pi Runtime 请求完成",
        {
          sessionId: input.harness.sessionId,
          providerId: input.target.provider.id,
          modelId: input.target.modelId,
          elapsedMs: Date.now() - startedAt,
        }
      );
      return { status: isStopped() ? "stopped" : "completed" };
    } catch (error) {
      if (isStopped()) return { status: "stopped" };
      if (!(error instanceof AgentRuntimeNotAvailableError)) {
        const message = getErrorMessage(error);
        logSystemEvent(
          "agent", "pi-runtime", "query:error", "Pi Runtime 请求失败",
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
      sessionHandle?.dispose();
      input.forwardEvent({
        type: "agent_status",
        status: isStopped() ? "stopped" : "finished",
        source: input.source,
      });
    }
  }

  private createToolGate(input: AgentRuntimeInput): ToolGate {
    // 无人值守用显式放行 Gate，而不是返回 undefined 让下游兜底成放行。
    if (input.harness.permissions.mode === "unattended") {
      return createUnattendedToolGate();
    }
    return input.toolGate;
  }

  deleteSessionData(sessionId: string, workspaceId: string): void {
    this.sessionBridge.deleteCheckpoint(sessionId, workspaceId);
  }

  dispose(): void {
    this.sessionBridge.disposeAll();
  }
}
