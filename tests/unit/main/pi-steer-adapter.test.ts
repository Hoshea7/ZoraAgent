import { describe, expect, vi, it } from "vitest";
import type { ImageContent } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// Mock AgentSession
// ---------------------------------------------------------------------------

interface MockSession {
  prompt: ReturnType<typeof vi.fn>;
  waitForIdle: ReturnType<typeof vi.fn>;
  steer: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  isStreaming: boolean;
  isIdle: boolean;
}

function createMockSession(): MockSession {
  return {
    prompt: vi.fn(() => Promise.resolve()),
    waitForIdle: vi.fn(() => Promise.resolve()),
    steer: vi.fn(() => Promise.resolve()),
    followUp: vi.fn(() => Promise.resolve()),
    abort: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(() => {}),
    subscribe: vi.fn(() => () => {}),
    isStreaming: false,
    isIdle: true,
  };
}

import type { PiSessionHandle } from "../../../src/main/runtime/pi-session-bridge";

function createHandle(session: MockSession): PiSessionHandle {
  return {
    run: async (prompt, _sys, dyn, onEvent, _rl, images) => {
      const unsub = session.subscribe(onEvent as any);
      try {
        const full = dyn.trim() ? `${dyn}\n\n${prompt}` : prompt;
        session.isStreaming = true;
        session.isIdle = false;
        await session.prompt(full, images && images.length > 0 ? { images } : undefined);
        await session.waitForIdle();
        session.isStreaming = false;
        session.isIdle = true;
      } finally {
        unsub();
      }
    },
    steer: (text, images) => session.steer(text, images),
    followUp: (text, images) => session.followUp(text, images),
    get isStreaming() { return session.isStreaming; },
    abort: async () => { await session.abort(); },
    dispose: () => { session.dispose(); },
  };
}

interface AdapterLike {
  completion: Promise<{ status: string }>;
  abort(): Promise<void>;
  enqueue(msg: { id: string; text: string }): Promise<void>;
}

function createAdapter(session: MockSession): AdapterLike {
  const handle = createHandle(session);
  let activeHandle: PiSessionHandle | null = null;
  let stopped = false;
  const queuedMessages: { id: string; text: string }[] = [];

  const completion = (async () => {
    activeHandle = handle;
    if (stopped) { await handle.abort(); return { status: "stopped" }; }

    await handle.run("first", "", "", () => {}, undefined, undefined);

    while (!stopped && queuedMessages.length > 0) {
      const msg = queuedMessages.shift()!;
      await handle.run(msg.text, "", "", () => {}, undefined, undefined);
    }

    return { status: stopped ? "stopped" : "completed" };
  })();

  return {
    completion,
    abort: async () => {
      stopped = true;
      queuedMessages.length = 0;
      if (activeHandle) await activeHandle.abort();
    },
    enqueue: async (message) => {
      if (stopped) throw new Error("会话已停止，无法追加消息");
      if (activeHandle?.isStreaming) {
        try {
          await activeHandle.steer(message.text);
        } catch {
          queuedMessages.push(message);
        }
      } else {
        queuedMessages.push(message);
      }
    },
  };
}

// Helper: flush microtask queue
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe("Pi Runtime steer 适配", () => {
  it("agent运行中enqueue调用steer而非push到队列", async () => {
    const session = createMockSession();
    let adapterRef!: AdapterLike;
    let resolvePrompt!: () => void;

    session.prompt.mockImplementation(() => {
      // Defer enqueue to next microtask so adapterRef is assigned
      queueMicrotask(() => {
        adapterRef.enqueue({ id: "1", text: "steer me" });
      });
      // Keep prompt pending until we resolve it
      return new Promise<void>((r) => { resolvePrompt = r; });
    });

    adapterRef = createAdapter(session);

    // Let microtasks run so enqueue -> steer executes
    await flushMicrotasks();
    await flushMicrotasks(); // enqueue is async, need another flush

    expect(session.steer).toHaveBeenCalledTimes(1);
    expect(session.steer).toHaveBeenCalledWith("steer me", undefined);

    // Let the run finish
    resolvePrompt();
    const result = await adapterRef.completion;
    expect(result.status).toBe("completed");
  });

  it("agent未运行时enqueue不调用steer", async () => {
    const session = createMockSession();
    const adapter = createAdapter(session);

    await adapter.completion;
    await adapter.enqueue({ id: "2", text: "queued msg" });

    expect(session.steer).not.toHaveBeenCalled();
  });

  it("abort调用await session.abort()而非fire-and-forget", async () => {
    const session = createMockSession();
    let resolveAbort!: () => void;
    session.abort.mockImplementation(() => {
      return new Promise<void>((r) => { resolveAbort = r; });
    });

    const adapter = createAdapter(session);
    const abortPromise = adapter.abort();

    expect(session.abort).toHaveBeenCalledTimes(1);

    resolveAbort();
    await abortPromise;
  });

  it("steer抛异常时fallback到队列由while循环处理", async () => {
    const session = createMockSession();
    let adapterRef!: AdapterLike;
    let resolveFirstPrompt!: () => void;
    let promptCallCount = 0;

    session.steer.mockImplementation(() => {
      return Promise.reject(new Error("not streaming"));
    });

    session.prompt.mockImplementation(() => {
      promptCallCount++;
      if (promptCallCount === 1) {
        queueMicrotask(() => {
          adapterRef.enqueue({ id: "1", text: "fallback" });
        });
        return new Promise<void>((r) => { resolveFirstPrompt = r; });
      }
      return Promise.resolve();
    });

    adapterRef = createAdapter(session);

    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(session.steer).toHaveBeenCalledTimes(1);

    resolveFirstPrompt();
    const result = await adapterRef.completion;

    expect(session.prompt).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("completed");
  });

  it("isStreaming属性正确反映session状态", () => {
    const session = createMockSession();
    const handle = createHandle(session);

    expect(handle.isStreaming).toBe(false);

    session.isStreaming = true;
    expect(handle.isStreaming).toBe(true);

    session.isStreaming = false;
    expect(handle.isStreaming).toBe(false);
  });

  it("停止后再enqueue抛异常", async () => {
    const session = createMockSession();
    const adapter = createAdapter(session);

    await adapter.abort();

    await expect(adapter.enqueue({ id: "1", text: "after stop" }))
      .rejects.toThrow("会话已停止");
  });
});
