import type { AgentStreamEvent } from "../../shared/zora";

/**
 * 生成唯一 ID
 */
export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 类型守卫：检查是否为对象
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 从错误对象中提取错误消息
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 从 Agent 错误中提取错误文本
 */
export function getAgentErrorText(error: unknown): string {
  return typeof error === "string" ? error : "Unknown agent error.";
}

/**
 * 从内容块中提取文本
 */
export function extractContentBlockText(block: unknown): string {
  if (!isRecord(block)) {
    return "";
  }

  if (block.type === "text" && typeof block.text === "string") {
    return block.text;
  }

  return "";
}

/**
 * 从内容块中提取思考内容
 */
export function extractContentBlockThinking(block: unknown): string {
  if (!isRecord(block)) {
    return "";
  }

  if (block.type === "thinking" && typeof block.thinking === "string") {
    return block.thinking;
  }

  return "";
}

/**
 * 从流式事件中提取文本和思考内容
 */
export function extractStreamChunks(streamEvent: AgentStreamEvent): {
  text: string;
  thinking: string;
} {
  if (streamEvent.type !== "stream_event" || !isRecord(streamEvent.event)) {
    return { text: "", thinking: "" };
  }

  const event = streamEvent.event;

  if (event.type === "content_block_start") {
    return {
      text: extractContentBlockText(event.content_block),
      thinking: extractContentBlockThinking(event.content_block)
    };
  }

  if (event.type === "content_block_delta" && isRecord(event.delta)) {
    if (event.delta.type === "text_delta" && typeof event.delta.text === "string") {
      return { text: event.delta.text, thinking: "" };
    }

    if (
      event.delta.type === "thinking_delta" &&
      typeof event.delta.thinking === "string"
    ) {
      return { text: "", thinking: event.delta.thinking };
    }
  }

  return { text: "", thinking: "" };
}

/**
 * 从助手消息中提取完整的文本和思考内容
 */
export function extractAssistantPayload(message: unknown): {
  text: string;
  thinking: string;
} {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return { text: "", thinking: "" };
  }

  let text = "";
  let thinking = "";

  for (const block of message.content) {
    text += extractContentBlockText(block);
    thinking += extractContentBlockThinking(block);
  }

  return { text, thinking };
}
