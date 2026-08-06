import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { ConversationMessage } from "../../shared/zora";
import type { PiProviderConfig } from "./pi-provider-registry";

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
export function buildPiConversationHistory(
  conversation: readonly ConversationMessage[],
  currentPrompt: string,
  provider: PiProviderConfig
): AgentMessage[] {
  const messages = [...conversation];
  const last = messages.at(-1);
  if (last?.role === "user" && last.text?.trim() === currentPrompt.trim()) {
    messages.pop();
  }

  return messages.flatMap((message): Message[] => {
    if (message.role === "user") {
      const text = message.text?.trim();
      return text
        ? [{ role: "user", content: text, timestamp: message.timestamp }]
        : [];
    }

    const text = assistantText(message);
    return text
      ? [createAssistantMessage(text, message.timestamp, provider)]
      : [];
  });
}
