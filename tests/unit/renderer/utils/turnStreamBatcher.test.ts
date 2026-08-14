import { TurnStreamBatcher, type FrameScheduler } from "@/renderer/utils/turnStreamBatcher";

function createScheduler() {
  let callback: (() => void) | undefined;
  const scheduler: FrameScheduler = {
    request(next) {
      callback = next;
      return 1;
    },
    cancel() {
      callback = undefined;
    },
  };
  return { scheduler, runFrame: () => callback?.() };
}

describe("TurnStreamBatcher", () => {
  it("preserves raw chunks and commits one batch per session in a frame", () => {
    const frames = createScheduler();
    const emitted = vi.fn();
    const batcher = new TurnStreamBatcher(emitted, frames.scheduler);

    batcher.enqueue("s1", { kind: "text", entityId: "body", chunk: "你好" });
    batcher.enqueue("s1", { kind: "text", entityId: "body", chunk: "，世界" });
    batcher.enqueue("s2", { kind: "thinking", chunk: "分析" });

    expect(emitted).not.toHaveBeenCalled();
    frames.runFrame();

    expect(emitted).toHaveBeenCalledTimes(2);
    expect(emitted).toHaveBeenNthCalledWith(1, {
      sessionId: "s1",
      deltas: [
        { kind: "text", entityId: "body", chunk: "你好" },
        { kind: "text", entityId: "body", chunk: "，世界" },
      ],
    });
  });

  it("flushes a lifecycle boundary without draining unrelated deltas", () => {
    const frames = createScheduler();
    const emitted = vi.fn();
    const batcher = new TurnStreamBatcher(emitted, frames.scheduler);

    batcher.enqueue("s1", { kind: "thinking", entityId: "thought", chunk: "思考" });
    batcher.enqueue("s1", { kind: "text", entityId: "body", chunk: "回答" });
    batcher.flush("s1", { entityId: "thought" });

    expect(emitted).toHaveBeenLastCalledWith({
      sessionId: "s1",
      deltas: [{ kind: "thinking", entityId: "thought", chunk: "思考" }],
    });
    frames.runFrame();
    expect(emitted).toHaveBeenLastCalledWith({
      sessionId: "s1",
      deltas: [{ kind: "text", entityId: "body", chunk: "回答" }],
    });
  });
});
