import type { AgentStreamEvent } from "../../shared/zora";
import { isRecord } from "../utils/guards";
import type { FeishuGateway } from "./gateway";

const MAX_CARD_TEXT_LENGTH = 25_000;

type FeishuGatewayLike = Pick<
  FeishuGateway,
  | "addTypingReaction"
  | "patchMessage"
  | "removeTypingReaction"
  | "replyMessage"
  | "sendMessage"
>;

type StreamState = {
  messageId: string;
  chatId: string;
  userMessageId: string;
  text: string;
  error: string | null;
  typingReactionId: string | null;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function buildTextContent(text: string): string {
  return JSON.stringify({ text });
}

function buildPostContent(text: string): string {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: "md", text }]],
    },
  });
}

function buildThinkingCard(): object {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      summary: {
        content: "Zora 思考中…",
      },
    },
    body: {
      elements: [
        {
          tag: "div",
          text: {
            tag: "plain_text",
            content: "思考中…",
            text_size: "notation",
            text_color: "grey",
          },
        },
      ],
    },
  };
}

function buildResultCard(text: string): object {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: text || "（无内容）",
        },
      ],
    },
  };
}

function extractAssistantText(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return "";
  }

  const textParts: string[] = [];

  for (const block of message.content) {
    if (!isRecord(block) || block.type !== "text" || !isNonEmptyString(block.text)) {
      continue;
    }

    textParts.push(block.text);
  }

  return textParts.join("");
}

export class FeishuMessageSender {
  private streamStates = new Map<string, StreamState>();

  constructor(private gateway: FeishuGatewayLike) {}

  async onAgentStart(chatId: string, userMessageId: string, sessionId: string): Promise<void> {
    let messageId = "";

    try {
      messageId = await this.gateway.replyMessage(
        userMessageId,
        "interactive",
        JSON.stringify(buildThinkingCard())
      );
    } catch (error) {
      console.error("[Feishu Sender] Failed to send thinking card, falling back:", error);
    }

    const typingReactionId = await this.gateway.addTypingReaction(userMessageId).catch(() => null);

    this.streamStates.set(sessionId, {
      messageId,
      chatId,
      userMessageId,
      text: "",
      error: null,
      typingReactionId,
    });
  }

  handleAgentEvent(sessionId: string, event: AgentStreamEvent): void {
    const state = this.streamStates.get(sessionId);
    if (!state || !isRecord(event) || typeof event.type !== "string") {
      return;
    }

    if (event.type === "agent_error" && isNonEmptyString(event.error)) {
      state.error = event.error;
      return;
    }

    if (event.type === "stream_event" && isRecord(event.event) && event.event.type === "content_block_delta") {
      const delta = isRecord(event.event.delta) ? event.event.delta : null;
      if (delta?.type === "text_delta" && isNonEmptyString(delta.text)) {
        state.text += delta.text;
      }
      return;
    }

    if (event.type === "assistant" && isRecord(event.message)) {
      const snapshotText = extractAssistantText(event.message).trim();
      if (snapshotText.length > 0) {
        state.text = snapshotText;
      }
    }
  }

  markError(sessionId: string, errorText: string): void {
    const state = this.streamStates.get(sessionId);
    if (state) {
      state.error = errorText;
    }
  }

  async onAgentEnd(sessionId: string, status: "success" | "error"): Promise<void> {
    const state = this.streamStates.get(sessionId);
    if (!state) {
      return;
    }

    try {
      const bodyText = this.normalizeBodyText(state.text, state.error, status);
      const chunks = this.splitText(bodyText, MAX_CARD_TEXT_LENGTH);

      if (state.messageId) {
        const success = await this.gateway.patchMessage(
          state.messageId,
          buildResultCard(chunks[0] ?? bodyText)
        );

        if (success) {
          for (const extraChunk of chunks.slice(1)) {
            await this.sendFinalContent(state.chatId, extraChunk);
          }
          return;
        }
      }

      let replyToMessageId: string | undefined = state.userMessageId;
      for (const chunk of chunks) {
        await this.sendFinalContent(state.chatId, chunk, replyToMessageId);
        replyToMessageId = undefined;
      }
    } catch (error) {
      console.error("[Feishu Sender] Final send error:", error);

      try {
        await this.sendText(
          state.chatId,
          this.normalizeBodyText(state.text, state.error, status),
          state.userMessageId
        );
      } catch (fallbackError) {
        console.error("[Feishu Sender] Fallback text send failed:", fallbackError);
      }
    } finally {
      await this.gateway
        .removeTypingReaction(state.userMessageId, state.typingReactionId)
        .catch(() => undefined);
      this.streamStates.delete(sessionId);
    }
  }

  async sendText(chatId: string, text: string, replyToMessageId?: string): Promise<void> {
    if (replyToMessageId) {
      await this.gateway.replyMessage(replyToMessageId, "text", buildTextContent(text));
      return;
    }

    await this.gateway.sendMessage(chatId, "text", buildTextContent(text));
  }

  private normalizeBodyText(
    text: string,
    error: string | null,
    status: "success" | "error"
  ): string {
    const trimmedText = text.trim();
    if (trimmedText.length > 0) {
      return trimmedText;
    }

    const trimmedError = error?.trim();
    if (trimmedError) {
      return trimmedError;
    }

    return status === "error" ? "❌ Zora 在处理这条消息时出错了。" : "（无内容）";
  }

  private async sendFinalContent(
    chatId: string,
    text: string,
    replyToMessageId?: string
  ): Promise<void> {
    try {
      const content = buildPostContent(text);
      if (replyToMessageId) {
        await this.gateway.replyMessage(replyToMessageId, "post", content);
      } else {
        await this.gateway.sendMessage(chatId, "post", content);
      }
      return;
    } catch (error) {
      console.warn("[Feishu Sender] Post send failed, trying text:", error);
    }

    try {
      if (replyToMessageId) {
        await this.gateway.replyMessage(replyToMessageId, "text", buildTextContent(text));
      } else {
        await this.gateway.sendMessage(chatId, "text", buildTextContent(text));
      }
      return;
    } catch (error) {
      console.warn("[Feishu Sender] Text reply failed, trying direct send:", error);
    }

    await this.gateway.sendMessage(chatId, "text", buildTextContent(text));
  }

  private splitText(text: string, maxLen: number): string[] {
    const chunks: string[] = [];
    let remaining = text.trim();

    while (remaining.length > maxLen) {
      let splitAt = remaining.lastIndexOf("\n\n", maxLen);
      if (splitAt <= 0) {
        splitAt = remaining.lastIndexOf("\n", maxLen);
      }
      if (splitAt <= 0) {
        splitAt = maxLen;
      }

      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks.length > 0 ? chunks : [text];
  }
}
