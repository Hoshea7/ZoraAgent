import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  mapPiEventToStreamEvent,
  PiEventMapper,
} from "@/main/runtime/pi-event-mapper";

describe("mapPiEventToStreamEvent", () => {
  it("maps text deltas to the stream protocol consumed by the renderer", () => {
    const event = {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "hello",
      },
    } as AgentSessionEvent;

    expect(mapPiEventToStreamEvent(event)).toEqual({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "hello" },
      },
    });
  });

  it("maps thinking lifecycle before the assistant snapshot arrives", () => {
    const start = {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "thinking_start",
        contentIndex: 0,
        partial: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "" }],
        },
      },
    } as AgentSessionEvent;
    const delta = {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "thinking_delta",
        contentIndex: 0,
        delta: "checking context",
      },
    } as AgentSessionEvent;
    const end = {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "thinking_end",
        contentIndex: 0,
        content: "checking context",
      },
    } as AgentSessionEvent;

    expect(mapPiEventToStreamEvent(start)).toEqual({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      },
    });
    expect(mapPiEventToStreamEvent(delta)).toEqual({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "checking context" },
      },
    });
    expect(mapPiEventToStreamEvent(end)).toEqual({
      type: "stream_event",
      event: { type: "content_block_stop", index: 0 },
    });
  });

  it("maps tool call argument streaming separately from tool execution", () => {
    const start = {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 1,
        partial: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "done" },
            { type: "toolCall", id: "tool-1", name: "read", arguments: {} },
          ],
        },
      },
    } as AgentSessionEvent;
    const delta = {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 1,
        delta: '{"path":"package.json"}',
      },
    } as AgentSessionEvent;

    expect(mapPiEventToStreamEvent(start)).toEqual({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "tool-1",
          name: "Read",
          input: "",
        },
      },
    });
    expect(mapPiEventToStreamEvent(delta)).toEqual({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: '{"path":"package.json"}',
        },
      },
    });
  });

  it("maps tool starts and normalizes Pi arguments", () => {
    expect(
      mapPiEventToStreamEvent({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "edit",
        args: {
          path: "/tmp/example.txt",
          edits: [{ oldText: "before", newText: "after" }],
        },
      })
    ).toEqual({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: -1,
        content_block: {
          type: "tool_use",
          id: "tool-1",
          name: "Edit",
          input: {
            file_path: "/tmp/example.txt",
            old_string: "before",
            new_string: "after",
          },
        },
      },
    });
  });

  it("does not emit a second tool start when execution follows a streamed tool call", () => {
    const mapper = new PiEventMapper();
    const streamedStart = {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        partial: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: {} }],
        },
      },
    } as AgentSessionEvent;

    expect(mapper.map(streamedStart)).toMatchObject({ type: "stream_event" });
    expect(
      mapper.map({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "package.json" },
      })
    ).toBeNull();
  });

  it("maps tool results to Claude-compatible user messages", () => {
    expect(
      mapPiEventToStreamEvent({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "read",
        result: {
          content: [{ type: "text", text: "package contents" }],
          details: {},
        },
        isError: false,
      })
    ).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "package contents",
            is_error: false,
          },
        ],
      },
    });
  });

  it("maps the final assistant message to a persistent snapshot", () => {
    const event = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "done" },
          {
            type: "toolCall",
            id: "tool-2",
            name: "find",
            arguments: { pattern: "**/*.ts" },
          },
        ],
        stopReason: "toolUse",
      },
    } as AgentSessionEvent;

    expect(mapPiEventToStreamEvent(event)).toEqual({
      type: "assistant",
      uuid: expect.any(String),
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "done" },
          {
            type: "tool_use",
            id: "tool-2",
            name: "Glob",
            input: { pattern: "**/*.ts" },
          },
        ],
        stop_reason: "tool_use",
      },
    });
  });


  it("keeps tool execution failures visible when Pi only provides error details", () => {
    expect(
      mapPiEventToStreamEvent({
        type: "tool_execution_end",
        toolCallId: "tool-failed",
        toolName: "read",
        result: { content: [], details: { error: "文件不存在" } },
        isError: true,
      })
    ).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-failed",
            content: "文件不存在",
            is_error: true,
          },
        ],
      },
    });
  });

  it("maps public Pi compaction lifecycle events to Claude system status events", () => {
    expect(
      mapPiEventToStreamEvent({ type: "compaction_start", reason: "threshold" })
    ).toEqual({
      type: "system",
      subtype: "status",
      status: "compacting",
    });
    expect(
      mapPiEventToStreamEvent({
        type: "compaction_end",
        reason: "threshold",
        result: undefined,
        aborted: false,
        willRetry: false,
      })
    ).toEqual({
      type: "system",
      subtype: "status",
      status: null,
    });
  });

  it("does not surface retryable provider errors before Pi settles", () => {
    const mapper = new PiEventMapper();
    const failure = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "temporary provider failure",
      },
    } as AgentSessionEvent;

    expect(mapper.map(failure)).toBeNull();
    expect(mapper.map({ type: "agent_end", messages: [], willRetry: true })).toBeNull();
    expect(
      mapper.map({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 2,
        delayMs: 10,
        errorMessage: "temporary provider failure",
      })
    ).toBeNull();
    expect(mapper.map(failure)).toBeNull();
    expect(mapper.map({ type: "agent_end", messages: [], willRetry: false })).toBeNull();
    expect(
      mapper.map({
        type: "auto_retry_end",
        success: false,
        attempt: 2,
        finalError: "provider retries exhausted",
      })
    ).toBeNull();
    expect(mapper.map({ type: "agent_settled" })).toEqual({
      type: "agent_error",
      error: "provider retries exhausted",
    });
  });

  it("reports a terminal output-limit response instead of completing normally", () => {
    const mapper = new PiEventMapper();
    const truncated = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial response" }],
        stopReason: "length",
      },
    } as AgentSessionEvent;

    expect(mapper.map(truncated)).toBeNull();
    expect(mapper.map({ type: "agent_settled" })).toEqual({
      type: "agent_error",
      error: "输出达到长度上限，任务未能完成。请发送“继续”后重试。",
    });
  });

  it("keeps a recoverable length stop open until Pi settles after compaction", () => {
    const mapper = new PiEventMapper();
    const truncated = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial response" }],
        stopReason: "length",
      },
    } as AgentSessionEvent;
    const completed = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "completed after compaction" }],
        stopReason: "stop",
      },
    } as AgentSessionEvent;

    expect(mapper.map(truncated)).toBeNull();
    expect(mapper.map({ type: "agent_end", messages: [], willRetry: false })).toBeNull();
    expect(mapper.map({ type: "compaction_start", reason: "overflow" })).toEqual({
      type: "system",
      subtype: "status",
      status: "compacting",
    });
    expect(
      mapper.map({
        type: "compaction_end",
        reason: "overflow",
        result: undefined,
        aborted: false,
        willRetry: true,
      })
    ).toEqual({
      type: "system",
      subtype: "status",
      status: null,
    });
    expect(mapper.map(completed)).toMatchObject({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "completed after compaction" }],
        stop_reason: "stop",
      },
    });
    expect(mapper.map({ type: "agent_settled" })).toEqual({ type: "result" });
  });

  it("keeps a terminal compaction failure open until Pi settles", () => {
    const mapper = new PiEventMapper();

    expect(mapper.map({ type: "compaction_start", reason: "threshold" })).toEqual({
      type: "system",
      subtype: "status",
      status: "compacting",
    });
    expect(
      mapper.map({
        type: "compaction_end",
        reason: "threshold",
        result: undefined,
        aborted: false,
        willRetry: false,
        errorMessage: "compaction provider failed",
      })
    ).toEqual({
      type: "system",
      subtype: "status",
      status: null,
    });
    expect(mapper.map({ type: "agent_settled" })).toEqual({
      type: "agent_error",
      error: "compaction provider failed",
    });
  });



  it("maps Pi provider failures to the control event consumed by the renderer", () => {
    const event = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "Provider request failed",
      },
    } as AgentSessionEvent;

    expect(mapPiEventToStreamEvent(event)).toEqual({
      type: "agent_error",
      error: "Provider request failed",
    });
  });
});
