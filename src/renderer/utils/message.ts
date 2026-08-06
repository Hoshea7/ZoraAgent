import type { AgentStreamEvent } from "../../shared/zora";

type AssistantBlockPayload =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "thinking";
      thinkingId?: string;
      thinking: string;
    }
  | {
      type: "tool_use";
      toolName: string;
      toolUseId: string;
      toolInput: string;
    };

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
 * 将未知内容安全地转成文本
 */
export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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
 * 从工具输入中提取文本
 */
export function extractToolUseInput(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (input === undefined || input === null) {
    return "";
  }

  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

/**
 * 从工具结果块中提取结果文本
 */
export function extractToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) =>
        isRecord(item) && typeof item.text === "string" ? item.text : ""
      )
      .join("");
  }

  return String(content ?? "");
}

/**
 * 从流式事件中提取文本、思考和工具调用内容
 */
export function extractStreamChunks(streamEvent: AgentStreamEvent): {
  blockStart?: AssistantBlockPayload;
  contentIndex?: number;
  textDelta?: string;
  thinkingDelta?: string;
  toolInputDelta?: string;
  blockStopIndex?: number;
} {
  if (streamEvent.type !== "stream_event" || !isRecord(streamEvent.event)) {
    return {};
  }

  const event = streamEvent.event;

  if (event.type === "content_block_start") {
    if (
      isRecord(event.content_block) &&
      event.content_block.type === "tool_use" &&
      typeof event.content_block.name === "string" &&
      typeof event.content_block.id === "string"
    ) {
      return {
        contentIndex: typeof event.index === "number" ? event.index : -1,
        blockStart: {
          type: "tool_use",
          toolName: event.content_block.name,
          toolUseId: event.content_block.id,
          toolInput: extractToolUseInput(event.content_block.input)
        }
      };
    }

    const text = extractContentBlockText(event.content_block);
    if (isRecord(event.content_block) && event.content_block.type === "text") {
      return {
        contentIndex: typeof event.index === "number" ? event.index : -1,
        blockStart: {
          type: "text",
          text
        }
      };
    }

    const thinking = extractContentBlockThinking(event.content_block);
    if (isRecord(event.content_block) && event.content_block.type === "thinking") {
      return {
        contentIndex: typeof event.index === "number" ? event.index : -1,
        blockStart: {
          type: "thinking",
          thinkingId:
            typeof event.content_block.id === "string"
              ? event.content_block.id
              : undefined,
          thinking
        }
      };
    }

    return {};
  }

  if (event.type === "content_block_delta" && isRecord(event.delta)) {
    if (event.delta.type === "text_delta" && typeof event.delta.text === "string") {
      return {
        contentIndex: typeof event.index === "number" ? event.index : -1,
        textDelta: event.delta.text,
      };
    }

    if (
      event.delta.type === "thinking_delta" &&
      typeof event.delta.thinking === "string"
    ) {
      return {
        contentIndex: typeof event.index === "number" ? event.index : -1,
        thinkingDelta: event.delta.thinking,
      };
    }

    if (
      event.delta.type === "input_json_delta" &&
      typeof event.delta.partial_json === "string"
    ) {
      return {
        contentIndex: typeof event.index === "number" ? event.index : -1,
        toolInputDelta: event.delta.partial_json,
      };
    }
  }

  if (event.type === "content_block_stop") {
    return {
      blockStopIndex: typeof event.index === "number" ? event.index : -1,
    };
  }

  return {};
}
