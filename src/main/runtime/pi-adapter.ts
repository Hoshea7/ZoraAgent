import { getErrorMessage, logSystemEvent } from "../system-log";
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
import { readFileSync } from "node:fs";
import path from "node:path";

function attachmentsToImagesAndText(
  attachments: FileAttachment[] | undefined
): { images: ImageContent[]; textPrefix: string } {
  if (!attachments || attachments.length === 0) {
    return { images: [], textPrefix: "" };
  }

  const images: ImageContent[] = [];
  const textParts: string[] = [];

  for (const attachment of attachments) {
    if (attachment.category === "image") {
      const base64Data =
        attachment.base64Data ||
        (attachment.localPath ? readFileSync(attachment.localPath).toString("base64") : "");
      if (base64Data) {
        images.push({
          type: "image",
          data: base64Data,
          mimeType: attachment.mimeType,
        });
      }
    } else if (attachment.category === "text" && attachment.localPath) {
      try {
        const content = readFileSync(attachment.localPath, "utf-8");
        const ext = path.extname(attachment.name).slice(1) || "text";
        textParts.push(`附件文件：${attachment.name}\n\n\`\`\`${ext}\n${content}\n\`\`\``);
      } catch {
        // skip unreadable files
      }
    } else if (attachment.category === "document") {
      textParts.push(`用户附带了一个文档文件：${attachment.name}，当前模型链路不支持直接读取文档内容。`);
    }
  }

  return { images, textPrefix: textParts.join("\n\n") };
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
    let activeHandle: Awaited<ReturnType<PiSessionBridge["getOrCreateAgent"]>> | null = null;
    let stopped = false;
    const queuedMessages: AgentRuntimeQueuedMessage[] = [];

    const completion = this.run(input, queuedMessages, (handle) => {
      activeHandle = handle;
      if (stopped) handle.abort();
    }, () => stopped);

    return {
      completion,
      abort: async () => {
        stopped = true;
        queuedMessages.length = 0;
        if (activeHandle) await activeHandle.abort();
      },
      enqueue: async (message) => {
        if (stopped) {
          throw new Error("会话已停止，无法追加消息");
        }
        if (activeHandle?.isStreaming) {
          try {
            await activeHandle.steer(message.text);
          } catch {
            queuedMessages.push(message);
          }
        } else {
          queuedMessages.push(message);
        }
      },
    };
  }

  private async run(
    input: AgentRuntimeInput,
    queuedMessages: AgentRuntimeQueuedMessage[],
    onAgentReady: (handle: Awaited<ReturnType<PiSessionBridge["getOrCreateAgent"]>>) => void,
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
      let handle;
      try {
        handle = await this.sessionBridge.getOrCreateAgent(
          input.harness.sessionId,
          providerConfig,
          input.harness.workspace.cwd,
          input.harness.model,
          input.harness.prompt.system,
          input.harness.conversation.messages,
          input.harness.prompt.user,
          [],
          this.createToolGate(input)
        );
        onAgentReady(handle);
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

      const { images, textPrefix } = attachmentsToImagesAndText(input.attachments);
      const userPrompt = textPrefix ? `${textPrefix}\n\n${input.harness.prompt.user}` : input.harness.prompt.user;

      await handle.run(
        userPrompt,
        input.harness.prompt.system,
        input.harness.prompt.dynamicContext,
        forwardPiEvent,
        input.harness.model.reasoningLevel,
        images.length > 0 ? images : undefined,
        budgetGuard
      );

      while (!isStopped() && queuedMessages.length > 0) {
        const message = queuedMessages.shift();
        if (!message) continue;
        await handle.run(
          message.text,
          input.harness.prompt.system,
          input.harness.prompt.dynamicContext,
          forwardPiEvent,
          input.harness.model.reasoningLevel,
          undefined,
          budgetGuard
        );
      }

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

  dispose(): void {
    this.sessionBridge.disposeAll();
  }
}
