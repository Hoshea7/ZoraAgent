import type { AgentStreamEvent } from "@/shared/zora";
import {
  extractStreamChunks,
  extractToolResultContent,
  extractToolUseInput,
} from "@/renderer/utils/message";

function createStreamEvent(event: Record<string, unknown>): AgentStreamEvent {
  return {
    type: "stream_event",
    event,
  } as AgentStreamEvent;
}

describe("extractStreamChunks", () => {
  it("assembles streamed tool arguments without the initial empty object placeholder", () => {
    const start = extractStreamChunks(createStreamEvent({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "read-1", name: "Read", input: {} },
    }));
    const delta = extractStreamChunks(createStreamEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"file_path":"/tmp/image.png"}' },
    }));
    const initial = start.blockStart?.type === "tool_use" ? start.blockStart.toolInput : "";
    expect(JSON.parse(initial + delta.toolInputDelta)).toEqual({ file_path: "/tmp/image.png" });
  });

  it("extracts text deltas", () => {
    expect(
      extractStreamChunks(
        createStreamEvent({
          type: "content_block_delta",
          index: 2,
          delta: { type: "text_delta", text: "hello" },
        })
      )
    ).toEqual({ contentIndex: 2, textDelta: "hello" });
  });

  it("extracts thinking deltas", () => {
    expect(
      extractStreamChunks(
        createStreamEvent({
          type: "content_block_delta",
          index: 1,
          delta: { type: "thinking_delta", thinking: "pondering" },
        })
      )
    ).toEqual({ contentIndex: 1, thinkingDelta: "pondering" });
  });

  it("extracts tool input json deltas", () => {
    expect(
      extractStreamChunks(
        createStreamEvent({
          type: "content_block_delta",
          index: 3,
          delta: { type: "input_json_delta", partial_json: "{\"path\":" },
        })
      )
    ).toEqual({ contentIndex: 3, toolInputDelta: "{\"path\":" });
  });

  it("extracts text block starts", () => {
    expect(
      extractStreamChunks(
        createStreamEvent({
          type: "content_block_start",
          index: 2,
          content_block: { type: "text", text: "hello" },
        })
      )
    ).toEqual({
      contentIndex: 2,
      blockStart: {
        type: "text",
        text: "hello",
      },
    });
  });

  it("extracts thinking block starts", () => {
    expect(
      extractStreamChunks(
        createStreamEvent({
          type: "content_block_start",
          index: 1,
          content_block: { type: "thinking", thinking: "step by step" },
        })
      )
    ).toEqual({
      contentIndex: 1,
      blockStart: {
        type: "thinking",
        thinking: "step by step",
      },
    });
  });

  it("extracts tool-use block starts", () => {
    expect(
      extractStreamChunks(
        createStreamEvent({
          type: "content_block_start",
          index: 3,
          content_block: {
            type: "tool_use",
            name: "read",
            id: "tool-1",
            input: { file_path: "/tmp/demo.txt" },
          },
        })
      )
    ).toEqual({
      contentIndex: 3,
      blockStart: {
        type: "tool_use",
        toolName: "read",
        toolUseId: "tool-1",
        toolInput: "{\"file_path\":\"/tmp/demo.txt\"}",
      },
    });
  });

  it("extracts the content index when a block ends", () => {
    expect(
      extractStreamChunks(
        createStreamEvent({ type: "content_block_stop", index: 4 })
      )
    ).toEqual({ blockStopIndex: 4 });
  });
});

describe("extractToolResultContent", () => {
  it("returns string content unchanged", () => {
    expect(extractToolResultContent("done")).toBe("done");
  });

  it("joins text entries from an array payload", () => {
    expect(
      extractToolResultContent([
        { text: "alpha" },
        { text: " beta" },
        { ignored: true },
      ])
    ).toBe("alpha beta");
  });

  it("returns an empty string for null content", () => {
    expect(extractToolResultContent(null)).toBe("");
  });
});

describe("extractToolUseInput", () => {
  it("returns string input unchanged", () => {
    expect(extractToolUseInput("{\"path\":\"/tmp/demo.txt\"}")).toBe("{\"path\":\"/tmp/demo.txt\"}");
  });

  it("stringifies object input", () => {
    expect(extractToolUseInput({ path: "/tmp/demo.txt" })).toBe("{\"path\":\"/tmp/demo.txt\"}");
  });

  it("returns an empty string for undefined input", () => {
    expect(extractToolUseInput(undefined)).toBe("");
  });

  it("returns an empty string for null input", () => {
    expect(extractToolUseInput(null)).toBe("");
  });
});
