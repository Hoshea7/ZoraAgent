import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
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

function extractToolResultText(result: unknown, isError = false): string {
  if (typeof result === "string") {
    return result;
  }
  if (!isRecord(result)) {
    return JSON.stringify(result ?? "");
  }

  if (Array.isArray(result.content)) {
    const contentText = result.content
      .map((item) => {
        if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("");
    if (contentText.length > 0) {
      return contentText;
    }
  }

  if (isError) {
    for (const key of ["error", "errorMessage", "message", "stderr"]) {
      if (typeof result[key] === "string" && result[key].length > 0) {
        return result[key];
      }
    }
    if (result.details !== undefined) {
      if (typeof result.details === "string") {
        return result.details;
      }
      if (isRecord(result.details)) {
        for (const key of ["error", "errorMessage", "message", "stderr"]) {
          if (typeof result.details[key] === "string" && result.details[key].length > 0) {
            return result.details[key];
          }
        }
      }
      const details = JSON.stringify(result.details);
      if (details && details !== "{}") {
        return details;
      }
    }
    return "工具执行失败。";
  }

  return JSON.stringify(result);
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
    uuid: randomUUID(),
    message: {
      role: "assistant",
      content,
      stop_reason: message.stopReason === "toolUse" ? "tool_use" : message.stopReason,
    },
  };
}

export function mapPiEventToStreamEvent(
  event: AgentSessionEvent
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
            content: extractToolResultText(event.result, event.isError),
            is_error: event.isError,
          },
        ],
      },
    };
  }

  if (event.type === "compaction_start") {
    return {
      type: "system",
      subtype: "status",
      status: "compacting",
    };
  }

  if (event.type === "compaction_end") {
    if (event.errorMessage && !event.willRetry && !event.aborted) {
      return { type: "agent_error", error: event.errorMessage };
    }
    return {
      type: "system",
      subtype: "status",
      status: null,
    };
  }

  if (event.type === "message_end") {
    return mapAssistantSnapshot(event.message);
  }

  if (event.type === "agent_end") {
    return null;
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
  private pendingProviderError: string | null = null;
  private terminalProviderError = false;

  map(event: AgentSessionEvent): AgentStreamEvent | null {
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

    if (event.type === "message_end") {
      const mapped = mapPiEventToStreamEvent(event);
      if (mapped?.type === "agent_error") {
        // Pi emits message_end before agent_end, where it decides whether this
        // provider failure will be retried. Delay the error so a retry does not
        // make the renderer close the live turn prematurely.
        this.pendingProviderError = mapped.error;
        return null;
      }
      this.pendingProviderError = null;
      return mapped;
    }

    if (event.type === "auto_retry_start") {
      this.pendingProviderError = null;
      return null;
    }

    if (event.type === "auto_retry_end") {
      if (!event.success) {
        this.pendingProviderError = event.finalError ?? this.pendingProviderError;
        this.terminalProviderError = true;
      }
      return null;
    }

    if (event.type === "agent_end") {
      if (event.willRetry) {
        return null;
      }
      if (this.pendingProviderError) {
        this.terminalProviderError = true;
      }
      return null;
    }

    if (event.type === "tool_execution_end") {
      this.streamedToolCallIds.delete(event.toolCallId);
    }

    if (event.type === "agent_settled") {
      this.streamedToolCallIds.clear();
      if (this.terminalProviderError || this.pendingProviderError) {
        const error = this.pendingProviderError ?? "Pi Provider 请求失败。";
        this.pendingProviderError = null;
        this.terminalProviderError = false;
        return { type: "agent_error", error };
      }

      return { type: "result" };
    }

    return mapPiEventToStreamEvent(event);
  }
}
