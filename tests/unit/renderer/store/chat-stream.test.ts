import { createStore } from "jotai";
import {
  addThinkingStepAtom,
  addToolStepAtom,
  applyAssistantSnapshotAtom,
  appendBodyTextAtom,
  appendThinkingAtom,
  appendToolInputAtom,
  completeThinkingStepAtom,
  sessionMessagesAtom,
  startBodySegmentAtom,
} from "@/renderer/store/chat";

function getOnlyTurn(store: ReturnType<typeof createStore>, sessionId: string) {
  const messages = store.get(sessionMessagesAtom)[sessionId] ?? [];
  expect(messages).toHaveLength(1);
  const turn = messages[0]?.role === "assistant" ? messages[0].turn : undefined;
  expect(turn).toBeDefined();
  return turn!;
}

describe("chat stream reducer", () => {
  it("keeps interleaved thinking and text deltas attached to their blocks", () => {
    const store = createStore();
    const sessionId = "session-interleaved";

    store.set(addThinkingStepAtom, sessionId, "", "thinking-0");
    store.set(startBodySegmentAtom, sessionId, "", "text-1");
    store.set(appendBodyTextAtom, sessionId, "final answer", "text-1");
    store.set(appendThinkingAtom, sessionId, "reasoning", "thinking-0");
    store.set(completeThinkingStepAtom, sessionId, "thinking-0");

    const turn = getOnlyTurn(store, sessionId);
    expect(turn.bodySegments).toEqual([{ id: "text-1", text: "final answer" }]);
    expect(turn.processSteps).toHaveLength(1);
    expect(turn.processSteps[0]).toMatchObject({
      type: "thinking",
      thinking: {
        id: "thinking-0",
        content: "reasoning",
      },
    });
    expect(
      turn.processSteps[0]?.type === "thinking"
        ? turn.processSteps[0].thinking.completedAt
        : undefined
    ).toEqual(expect.any(Number));
  });

  it("uses the final assistant snapshot as an idempotent reconciliation", () => {
    const store = createStore();
    const sessionId = "session-snapshot";

    store.set(addThinkingStepAtom, sessionId, "reasoning", "thinking-0");
    store.set(completeThinkingStepAtom, sessionId, "thinking-0");
    store.set(startBodySegmentAtom, sessionId, "answer", "text-1");
    store.set(applyAssistantSnapshotAtom, sessionId, {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "reasoning" },
          { type: "text", text: "answer" },
        ],
      },
    });

    const turn = getOnlyTurn(store, sessionId);
    expect(turn.processSteps).toHaveLength(1);
    expect(turn.bodySegments).toEqual([{ id: "text-1", text: "answer" }]);
  });

  it("merges streamed and execution tool starts by tool call id", () => {
    const store = createStore();
    const sessionId = "session-tool";

    store.set(addToolStepAtom, sessionId, "Read", "tool-1", "");
    store.set(appendToolInputAtom, sessionId, '{"path":"package.json"}', "tool-1");
    store.set(applyAssistantSnapshotAtom, sessionId, {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "Read",
          input: { file_path: "package.json" },
        }],
      },
    });

    const turn = getOnlyTurn(store, sessionId);
    expect(turn.processSteps).toHaveLength(1);
    expect(turn.processSteps[0]).toMatchObject({
      type: "tool",
      tool: {
        id: "tool-1",
        name: "Read",
        status: "running",
      },
    });
    expect(
      turn.processSteps[0]?.type === "tool"
        ? JSON.parse(turn.processSteps[0].tool.input)
        : null
    ).toEqual({ file_path: "package.json" });
  });
});
