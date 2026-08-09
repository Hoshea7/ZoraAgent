import {
  CATCHUP_FRAMES,
  StreamSmoothBuffer,
  StreamSmoother,
  frameTake,
  type SmoothScheduler,
  type SmoothStreamChunk,
} from "@/renderer/utils/streamSmoother";

describe("frameTake", () => {
  it("returns 0 for empty buffer", () => {
    expect(frameTake(0, CATCHUP_FRAMES)).toBe(0);
  });

  it("spreads pending chars evenly across the remaining frames", () => {
    expect(frameTake(120, 6)).toBe(20);
    expect(frameTake(100, 5)).toBe(20);
  });

  it("never emits slower than the typical arrival rate", () => {
    expect(frameTake(2, 6)).toBe(2);
    expect(frameTake(5, 6)).toBe(2);
  });

  it("takes everything on the last frame", () => {
    expect(frameTake(37, 1)).toBe(37);
  });
});

describe("StreamSmoothBuffer", () => {
  const textKey = { sessionId: "s1", kind: "text" as const, entityId: "seg-1" };

  it("merges chunks for the same slot and drains in FIFO order", () => {
    const buffer = new StreamSmoothBuffer();
    buffer.enqueue(textKey, "你好");
    buffer.enqueue(textKey, "世界");

    let joined = "";
    while (buffer.size > 0) {
      joined += buffer.drainFrame().map((chunk) => chunk.chunk).join("");
    }
    expect(joined).toBe("你好世界");
    expect(buffer.size).toBe(0);
  });

  it("drains each slot independently within one frame", () => {
    const buffer = new StreamSmoothBuffer();
    buffer.enqueue(textKey, "ab");
    buffer.enqueue({ sessionId: "s1", kind: "thinking", entityId: "th-1" }, "cd");

    const drained = buffer.drainFrame();
    expect(drained).toHaveLength(2);
    expect(drained.map((chunk) => chunk.chunk)).toEqual(["ab", "cd"]);
    expect(buffer.size).toBe(0);
  });

  it("keeps slots distinct when key parts would otherwise concatenate identically", () => {
    const buffer = new StreamSmoothBuffer();
    buffer.enqueue({ sessionId: "ab", kind: "text", entityId: "c" }, "first");
    buffer.enqueue({ sessionId: "a", kind: "text", entityId: "bc" }, "second");

    const drained = buffer.flush();
    expect(drained).toHaveLength(2);
    expect(drained.map((chunk) => chunk.chunk)).toEqual(["first", "second"]);
  });

  it("does not split an emoji surrogate pair across frames", () => {
    const buffer = new StreamSmoothBuffer();
    buffer.enqueue(textKey, `a${"😀".repeat(10)}`);

    const chunks: string[] = [];
    while (buffer.size > 0) {
      chunks.push(...buffer.drainFrame().map((chunk) => chunk.chunk));
    }

    expect(chunks.join("")).toBe(`a${"😀".repeat(10)}`);
    expect(chunks.every((chunk) => !chunk.includes("\uFFFD"))).toBe(true);
    expect(chunks.every((chunk) => {
      const last = chunk.charCodeAt(chunk.length - 1);
      return !(last >= 0xd800 && last <= 0xdbff);
    })).toBe(true);
  });

  it("spreads a burst evenly across CATCHUP_FRAMES frames", () => {
    const buffer = new StreamSmoothBuffer();
    buffer.enqueue(textKey, "x".repeat(120));

    const takes: number[] = [];
    while (buffer.size > 0) {
      const frame = buffer.drainFrame();
      takes.push(frame.reduce((sum, chunk) => sum + chunk.chunk.length, 0));
    }

    expect(takes).toHaveLength(CATCHUP_FRAMES);
    expect(takes.reduce((sum, take) => sum + take, 0)).toBe(120);
    // 匀速：各帧放出量相等（20/帧），这是"平滑感"的来源
    expect(new Set(takes).size).toBe(1);
  });

  it("keeps up with a steady trickle without accumulating lag", () => {
    const buffer = new StreamSmoothBuffer();

    // 模拟稳定低速流：每帧到达 2 字符，放出量应跟上，不积压
    for (let frame = 0; frame < 30; frame += 1) {
      buffer.enqueue(textKey, "ab");
      buffer.drainFrame();
      expect(buffer.size).toBeLessThanOrEqual(4);
    }
  });

  it("flushes only the slots matching session and filter", () => {
    const buffer = new StreamSmoothBuffer();
    buffer.enqueue(textKey, "text-s1");
    buffer.enqueue({ sessionId: "s1", kind: "toolInput", entityId: "tool-1" }, "input-s1");
    buffer.enqueue({ sessionId: "s2", kind: "text", entityId: "seg-9" }, "text-s2");

    const byEntity = buffer.flush("s1", { entityId: "tool-1" });
    expect(byEntity.map((chunk) => chunk.chunk)).toEqual(["input-s1"]);

    const bySession = buffer.flush("s1");
    expect(bySession.map((chunk) => chunk.chunk)).toEqual(["text-s1"]);

    expect(buffer.size).toBe("text-s2".length);
  });

  it("flush without session drains everything", () => {
    const buffer = new StreamSmoothBuffer();
    buffer.enqueue(textKey, "a");
    buffer.enqueue({ sessionId: "s2", kind: "text" }, "b");

    const flushed = buffer.flush();
    expect(flushed).toHaveLength(2);
    expect(buffer.size).toBe(0);
  });
});

describe("StreamSmoother", () => {
  function createManualScheduler() {
    const callbacks = new Map<number, () => void>();
    let nextHandle = 1;

    const scheduler: SmoothScheduler = {
      request(cb) {
        const handle = nextHandle;
        nextHandle += 1;
        callbacks.set(handle, cb);
        return handle;
      },
      cancel(handle) {
        callbacks.delete(handle);
      },
    };

    return {
      scheduler,
      runFrame() {
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach((cb) => cb());
      },
      isScheduled() {
        return callbacks.size > 0;
      },
    };
  }

  it("drips chunks across frames and stops when drained", () => {
    const emitted: SmoothStreamChunk[] = [];
    const harness = createManualScheduler();
    const smoother = new StreamSmoother((chunk) => emitted.push(chunk), harness.scheduler);

    smoother.enqueue({ sessionId: "s1", kind: "text", entityId: "seg-1" }, "x".repeat(60));
    expect(harness.isScheduled()).toBe(true);
    expect(emitted).toHaveLength(0);

    harness.runFrame();
    expect(emitted[0].chunk.length).toBe(10);

    while (harness.isScheduled()) {
      harness.runFrame();
    }

    const joined = emitted.map((chunk) => chunk.chunk).join("");
    expect(joined).toBe("x".repeat(60));
    expect(smoother.pendingSize).toBe(0);
  });

  it("flush emits remaining content immediately and stops the loop", () => {
    const emitted: SmoothStreamChunk[] = [];
    const harness = createManualScheduler();
    const smoother = new StreamSmoother((chunk) => emitted.push(chunk), harness.scheduler);

    smoother.enqueue({ sessionId: "s1", kind: "thinking", entityId: "th-1" }, "y".repeat(50));
    smoother.flush("s1", { entityId: "th-1" });

    expect(emitted.map((chunk) => chunk.chunk).join("")).toBe("y".repeat(50));
    expect(harness.isScheduled()).toBe(false);

    harness.runFrame();
    expect(emitted).toHaveLength(1);
  });

  it("dispose cancels the scheduled frame without emitting", () => {
    const emitted: SmoothStreamChunk[] = [];
    const harness = createManualScheduler();
    const smoother = new StreamSmoother((chunk) => emitted.push(chunk), harness.scheduler);

    smoother.enqueue({ sessionId: "s1", kind: "text" }, "data");
    smoother.dispose();

    expect(harness.isScheduled()).toBe(false);
    expect(smoother.pendingSize).toBe(0);
  });
});
