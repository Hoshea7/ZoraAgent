import type { AgentEvent } from "@earendil-works/pi-agent-core";
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
    } as AgentEvent;

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
    } as AgentEvent;
    const delta = {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "thinking_delta",
        contentIndex: 0,
        delta: "checking context",
      },
    } as AgentEvent;
    const end = {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "thinking_end",
        contentIndex: 0,
        content: "checking context",
      },
    } as AgentEvent;

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
    } as AgentEvent;
    const delta = {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 1,
        delta: '{"path":"package.json"}',
      },
    } as AgentEvent;

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
    } as AgentEvent;

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
    } as AgentEvent;

    expect(mapPiEventToStreamEvent(event)).toEqual({
      type: "assistant",
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

  it("maps Pi provider failures to the control event consumed by the renderer", () => {
    const event = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "Provider request failed",
      },
    } as AgentEvent;

    expect(mapPiEventToStreamEvent(event)).toEqual({
      type: "agent_error",
      error: "Provider request failed",
    });
  });
});
