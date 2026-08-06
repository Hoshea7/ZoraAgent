import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AgentStreamEvent } from "../../shared/zora";

export const PI_TOOL_NAME_MAP: Record<string, string> = {
  read: "Read",
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  glob: "Glob",
  find: "Glob",
  ls: "Glob",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizePiToolInput(
  toolName: string,
  input: unknown
): Record<string, unknown> {
  if (!isRecord(input)) {
    return {};
  }

  const normalized = { ...input };
  if (typeof normalized.path === "string") {
    normalized.file_path = normalized.path;
    delete normalized.path;
  }

  if (toolName.toLowerCase() === "edit" && Array.isArray(normalized.edits)) {
    const firstEdit = normalized.edits.find(isRecord);
    if (firstEdit) {
      if (typeof firstEdit.oldText === "string") {
        normalized.old_string = firstEdit.oldText;
      }
      if (typeof firstEdit.newText === "string") {
        normalized.new_string = firstEdit.newText;
      }
    }
    delete normalized.edits;
  }

  return normalized;
}

function toolNameForRenderer(toolName: string): string {
  return PI_TOOL_NAME_MAP[toolName.toLowerCase()] ?? toolName;
}

function getPartialContentBlock(
  partial: unknown,
  contentIndex: number
): Record<string, unknown> | null {
  if (!isRecord(partial) || !Array.isArray(partial.content)) {
    return null;
  }

  const block = partial.content[contentIndex];
  return isRecord(block) ? block : null;
}

function extractToolResultText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return JSON.stringify(result ?? "");
  }

  return result.content
    .map((item) => {
      if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
      return "";
    })
    .join("");
}

function mapAssistantSnapshot(message: unknown): AgentStreamEvent | null {
  if (!isRecord(message) || message.role !== "assistant") {
    return null;
  }

  if (message.stopReason === "error" && typeof message.errorMessage === "string") {
    return { type: "agent_error", error: message.errorMessage };
  }

  const content: Record<string, unknown>[] = [];
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!isRecord(block)) {
        continue;
      }
      if (block.type === "text" && typeof block.text === "string") {
        content.push({ type: "text", text: block.text });
        continue;
      }
      if (block.type === "thinking" && typeof block.thinking === "string") {
        content.push({ type: "thinking", thinking: block.thinking });
        continue;
      }
      if (
        block.type === "toolCall" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        content.push({
          type: "tool_use",
          id: block.id,
          name: toolNameForRenderer(block.name),
          input: normalizePiToolInput(block.name, block.arguments),
        });
      }
    }
  }

  return {
    type: "assistant",
    message: {
      role: "assistant",
      content,
      stop_reason: message.stopReason === "toolUse" ? "tool_use" : message.stopReason,
    },
  };
}

export function mapPiEventToStreamEvent(
  event: AgentEvent
): AgentStreamEvent | null {
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (update.type === "text_start") {
      return {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: update.contentIndex,
          content_block: { type: "text", text: "" },
        },
      };
    }
    if (update.type === "text_delta") {
      return {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: update.contentIndex,
          delta: { type: "text_delta", text: update.delta },
        },
      };
    }
    if (update.type === "text_end") {
      return {
        type: "stream_event",
        event: {
          type: "content_block_stop",
          index: update.contentIndex,
        },
      };
    }
    if (update.type === "thinking_start") {
      const block = getPartialContentBlock(update.partial, update.contentIndex);
      return {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: update.contentIndex,
          content_block: {
            type: "thinking",
            thinking:
              block?.type === "thinking" && typeof block.thinking === "string"
                ? block.thinking
                : "",
          },
        },
      };
    }
    if (update.type === "thinking_delta") {
      return {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: update.contentIndex,
          delta: { type: "thinking_delta", thinking: update.delta },
        },
      };
    }
    if (update.type === "thinking_end") {
      return {
        type: "stream_event",
        event: {
          type: "content_block_stop",
          index: update.contentIndex,
        },
      };
    }
    if (update.type === "toolcall_start") {
      const block = getPartialContentBlock(update.partial, update.contentIndex);
      if (
        block?.type !== "toolCall" ||
        typeof block.id !== "string" ||
        typeof block.name !== "string"
      ) {
        return null;
      }

      return {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: update.contentIndex,
          content_block: {
            type: "tool_use",
            id: block.id,
            name: toolNameForRenderer(block.name),
            input: "",
          },
        },
      };
    }
    if (update.type === "toolcall_delta") {
      return {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: update.contentIndex,
          delta: { type: "input_json_delta", partial_json: update.delta },
        },
      };
    }
    if (update.type === "toolcall_end") {
      return {
        type: "stream_event",
        event: {
          type: "content_block_stop",
          index: update.contentIndex,
        },
      };
    }
    if (update.type === "done") {
      const stopReason = update.reason === "toolUse" ? "tool_use" : update.reason;
      return {
        type: "stream_event",
        event: {
          type: "message_delta",
          stop_reason: stopReason,
          delta: { stop_reason: stopReason },
        },
      };
    }
  }

  if (
    event.type === "message_start" &&
    isRecord(event.message) &&
    event.message.role === "assistant"
  ) {
    return {
      type: "stream_event",
      event: {
        type: "message_start",
        message: { role: "assistant", content: [] },
      },
    };
  }

  if (event.type === "tool_execution_start") {
    return {
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: -1,
        content_block: {
          type: "tool_use",
          id: event.toolCallId,
          name: toolNameForRenderer(event.toolName),
          input: normalizePiToolInput(event.toolName, event.args),
        },
      },
    };
  }

  if (event.type === "tool_execution_end") {
    return {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: event.toolCallId,
            content: extractToolResultText(event.result),
            is_error: event.isError,
          },
        ],
      },
    };
  }

  if (event.type === "message_end") {
    return mapAssistantSnapshot(event.message);
  }

  if (event.type === "agent_end") {
    return { type: "result" };
  }

  return null;
}

/**
 * Keeps Pi's provider-stream and tool-execution lifecycles idempotent.
 * Some providers emit a toolcall block before Pi later emits the execution
 * event for the same call. The renderer only needs one tool start.
 */
export class PiEventMapper {
  private readonly streamedToolCallIds = new Set<string>();

  map(event: AgentEvent): AgentStreamEvent | null {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "toolcall_start"
    ) {
      const update = event.assistantMessageEvent;
      const block = getPartialContentBlock(update.partial, update.contentIndex);
      if (block?.type === "toolCall" && typeof block.id === "string") {
        this.streamedToolCallIds.add(block.id);
      }
    }

    if (
      event.type === "tool_execution_start" &&
      this.streamedToolCallIds.has(event.toolCallId)
    ) {
      return null;
    }

    const mapped = mapPiEventToStreamEvent(event);
    if (event.type === "tool_execution_end") {
      this.streamedToolCallIds.delete(event.toolCallId);
    }
    if (event.type === "agent_end") {
      this.streamedToolCallIds.clear();
    }
    return mapped;
  }
}
