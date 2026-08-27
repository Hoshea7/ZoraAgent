import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { ConversationMessage } from "../../shared/zora";
import type { PiProviderConfig } from "./pi-provider-registry";
import { resolveAttachmentContent } from "../attachment-handler";
import { formatUserMessageForRuntime } from "../../shared/response-annotations";

function assistantText(message: ConversationMessage): string {
  if (message.role !== "assistant" || !message.turn) return "";

  const body = message.turn.bodySegments
    .map((segment) => segment.text)
    .join("")
    .trim();
  if (body) return body;

  return message.turn.processSteps
    .filter((step) => step.type === "tool")
    .map((step) => {
      const result = step.tool.result?.trim();
      return result
        ? `[${step.tool.name}]\n${result}`
        : `[${step.tool.name}]`;
    })
    .join("\n\n")
    .trim();
}

function createAssistantMessage(
  text: string,
  timestamp: number,
  provider: PiProviderConfig
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: provider.api,
    provider: provider.providerId,
    model: provider.model,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp,
  };
}

/**
 * Zora owns the durable conversation. Pi receives a fresh projection before
 * each user-initiated run so changing runtimes does not split the transcript.
 */
export async function buildPiConversationHistory(
  conversation: readonly ConversationMessage[],
  currentPrompt: string,
  provider: PiProviderConfig,
  context?: import("../../shared/types/product-tools").ProductToolRunContext
): Promise<Message[]> {
  const messages = [...conversation];
  const last = messages.at(-1);
  if (
    last?.role === "user" &&
    formatUserMessageForRuntime({
      text: last.text ?? "",
      responseAnnotations: last.responseAnnotations,
    }) === currentPrompt.trim()
  ) {
    messages.pop();
  }

  const projected: Message[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = formatUserMessageForRuntime({
        text: message.text ?? "",
        responseAnnotations: message.responseAnnotations,
      });
      const attachments = await resolveAttachmentContent(
        message.attachments ?? [],
        { imageMode: "neutral" },
        context
          ? {
              workspaceId: context.workspaceId,
              sessionId: context.sessionId,
              workingDirectory: context.workingDirectory,
              signal: new AbortController().signal,
            }
          : undefined
      );
      const content = [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...attachments,
      ];
      if (content.length === 0) continue;
      projected.push({
        role: "user",
        content: attachments.length > 0 ? content : text!,
        timestamp: message.timestamp,
      });
      continue;
    }

    const text = assistantText(message);
    if (text) projected.push(createAssistantMessage(text, message.timestamp, provider));
  }
  return projected;
}
