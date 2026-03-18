import type { AgentStreamEvent } from "../../shared/zora";
import type { FeishuGateway } from "./gateway";

type FeishuGatewayLike = Pick<FeishuGateway, "replyMessage" | "sendMessage">;

type ReplyBuffer = {
  text: string;
  chatId: string;
  userMessageId: string;
  toolCalls: number;
  error: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeTextChunk(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function appendChunk(existing: string, next: string): string {
  if (!next.trim()) {
    return existing;
  }

  if (!existing.trim()) {
    return next.trim();
  }

  return `${existing.trimEnd()}\n\n${next.trimStart()}`;
}

export class FeishuMessageSender {
  private buffers = new Map<string, ReplyBuffer>();

  constructor(private gateway: FeishuGatewayLike) {}

  initBuffer(sessionId: string, chatId: string, userMessageId: string): void {
    this.buffers.set(sessionId, {
      text: "",
      chatId,
      userMessageId,
      toolCalls: 0,
      error: null,
    });
  }

  handleAgentEvent(sessionId: string, event: AgentStreamEvent): void {
    const buffer = this.buffers.get(sessionId);
    if (!buffer || !isRecord(event) || typeof event.type !== "string") {
      return;
    }

    if (event.type === "agent_error" && typeof event.error === "string") {
      buffer.error = event.error;
      return;
    }

    if (event.type !== "assistant" || !isRecord(event.message)) {
      return;
    }

    const content = Array.isArray(event.message.content) ? event.message.content : [];

    for (const block of content) {
      if (!isRecord(block) || typeof block.type !== "string") {
        continue;
      }

      if (block.type === "text") {
        buffer.text = appendChunk(buffer.text, normalizeTextChunk(block.text));
        continue;
      }

      if (block.type === "tool_use") {
        buffer.toolCalls += 1;
      }
    }
  }

  markError(sessionId: string, errorText: string): void {
    const buffer = this.buffers.get(sessionId);
    if (!buffer) {
      return;
    }

    buffer.error = errorText;
  }

  async sendFinalReply(
    sessionId: string,
    status: "success" | "error"
  ): Promise<void> {
    const buffer = this.buffers.get(sessionId);
    if (!buffer) {
      return;
    }

    const bodyText =
      buffer.text.trim() ||
      buffer.error?.trim() ||
      (status === "error" ? "❌ Zora 在处理这条消息时出错了。" : "(无内容)");

    try {
      const chunks = this.splitText(bodyText, 25_000);

      if (chunks.length <= 1) {
        await this.gateway.replyMessage(
          buffer.userMessageId,
          "interactive",
          JSON.stringify(this.buildReplyCard(bodyText, buffer.toolCalls, status))
        );
        return;
      }

      for (const chunk of chunks) {
        await this.gateway.sendMessage(
          buffer.chatId,
          "interactive",
          JSON.stringify(this.buildReplyCard(chunk, buffer.toolCalls, status))
        );
      }
    } catch (error) {
      console.error("[Feishu Sender] Failed to send reply card:", error);

      try {
        await this.gateway.sendMessage(
          buffer.chatId,
          "text",
          JSON.stringify({ text: bodyText || "(Zora 回复失败)" })
        );
      } catch (fallbackError) {
        console.error("[Feishu Sender] Fallback text send failed:", fallbackError);
      }
    } finally {
      this.buffers.delete(sessionId);
    }
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.gateway.sendMessage(
      chatId,
      "interactive",
      JSON.stringify(this.buildSimpleCard(text))
    );
  }

  private buildReplyCard(
    text: string,
    toolCalls: number,
    status: "success" | "error"
  ): object {
    const elements: object[] = [
      {
        tag: "markdown",
        content: text || "(无内容)",
      },
    ];

    if (toolCalls > 0) {
      elements.push({ tag: "hr" });
      elements.push({
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: `🔧 ${toolCalls} tool calls`,
          },
        ],
      });
    }

    return {
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "✨ Zora" },
        template: status === "error" ? "red" : "indigo",
      },
      body: { elements },
    };
  }

  private buildSimpleCard(text: string): object {
    return {
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "✨ Zora" },
        template: "indigo",
      },
      body: {
        elements: [
          {
            tag: "markdown",
            content: text || "(无内容)",
          },
        ],
      },
    };
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
