import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

vi.mock("@/main/runtime/pi-mcp-bridge", () => ({
  createPiMcpTools: vi.fn(async () => []),
  disposePiMcpConnections: vi.fn(),
}));

import { PiAgentRuntimeAdapter } from "@/main/runtime/pi-adapter";
import type { PiSessionHandle } from "@/main/runtime/pi-session-bridge";
import { PiSessionBridge } from "@/main/runtime/pi-session-bridge";
import { AgentRuntimeNotAvailableError } from "@/main/runtime/types";
import type { ProviderConfig } from "@/shared/types/provider";

function createProvider(): ProviderConfig {
  return {
    id: "provider-1",
    name: "OpenAI compatible",
    providerType: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "encrypted-value",
    modelId: "gpt-5-mini",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createInput(forwardEvent = vi.fn()) {
  return {
    harness: {
      profileId: "productivity" as const,
      sessionId: "session-1",
      workspaceId: "workspace-1",
      prompt: { user: "hello", dynamicContext: "context", system: "system" },
      conversation: { messages: [], persistence: "durable" as const },
      workspace: { cwd: "/tmp/project" },
      permissions: { mode: "interactive" as const },
      model: { maxOutputTokens: 16_384, reasoningLevel: "high" },
      budget: { maxTurns: 120 },
      output: { incremental: true, visible: true },
    },
    forwardEvent,
    target: {
      agentRuntimeType: "pi" as const,
      provider: { ...createProvider(), apiKey: "sk-live" },
      protocol: "openai-completions" as const,
      modelId: "gpt-5-mini",
      contextWindow: 200_000,
    },
    source: "desktop" as const,
    vision: {
      imageInputCapability: "unknown" as const,
      visionRelayEnabled: true,
    },
  };
}

function createMockHandle(
  overrides: Partial<PiSessionHandle> = {}
): PiSessionHandle {
  return {
    run: vi.fn(async (_prompt, _system, _context, onEvent) => {
      onEvent({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "package.json" },
      } as AgentSessionEvent);
    }),
    abort: vi.fn(),
    steer: vi.fn(),
    followUp: vi.fn(),
    compact: vi.fn(),
    markUserMessageConsumed: vi.fn(),
    isStreaming: false,
    dispose: vi.fn(),
    ...overrides,
  };
}

describe("PiAgentRuntimeAdapter", () => {
  it("runs a Pi session and forwards mapped events", async () => {
    const handle = createMockHandle();
    const bridge = {
      createTurn: vi.fn(async () => handle),
      disposeAll: vi.fn(),
    } as unknown as PiSessionBridge;
    const forwardEvent = vi.fn();
    const adapter = new PiAgentRuntimeAdapter({ sessionBridge: bridge });

    await expect(adapter.start(createInput(forwardEvent)).completion).resolves.toEqual({
      status: "completed",
    });
    expect(forwardEvent).toHaveBeenNthCalledWith(1, {
      type: "agent_status",
      status: "started",
      source: "desktop",
    });
    expect(forwardEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "stream_event" })
    );
    expect(forwardEvent).toHaveBeenLastCalledWith({
      type: "agent_status",
      status: "finished",
      source: "desktop",
    });
    expect(handle.run).toHaveBeenCalledOnce();
  });

  it("runs manual compaction without creating an Agent turn", async () => {
    const handle = createMockHandle({
      compact: vi.fn(async (onEvent) => {
        onEvent({
          type: "compaction_end",
          result: { estimatedTokensAfter: 18_000 },
          aborted: false,
        } as AgentSessionEvent);
      }),
    });
    const forwardEvent = vi.fn();
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        createTurn: vi.fn(async () => handle),
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });

    const input = createInput(forwardEvent);
    input.harness.conversation.messages = [
      {
        id: "latest-user",
        role: "user",
        text: "latest prompt",
        timestamp: 1,
      },
    ];
    await expect(adapter.compact(input)).resolves.toEqual({
      status: "compacted",
    });

    expect(handle.compact).toHaveBeenCalledOnce();
    expect(handle.markUserMessageConsumed).toHaveBeenCalledWith("latest-user");
    expect(handle.run).not.toHaveBeenCalled();
    expect(forwardEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "context_usage",
        state: expect.objectContaining({
          usedTokens: 18_000,
          compactionCount: 1,
        }),
      })
    );
    expect(forwardEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_status" })
    );
  });

  it("reports a native Pi compaction noop as not needed", async () => {
    const handle = createMockHandle({
      compact: vi.fn(async () => {
        throw new Error("Nothing to compact (session too small)");
      }),
    });
    const forwardEvent = vi.fn();
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        createTurn: vi.fn(async () => handle),
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });

    await expect(adapter.compact(createInput(forwardEvent))).resolves.toEqual({
      status: "not_needed",
      message: "当前上下文无需压缩",
    });
    expect(forwardEvent).not.toHaveBeenCalled();
    expect(handle.dispose).toHaveBeenCalledOnce();
  });

  it("passes image attachments to Pi as authoritative ID references", async () => {
    const handle = createMockHandle();
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        createTurn: vi.fn(async () => handle),
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });
    const input = {
      ...createInput(),
      attachments: [{
        id: "image-1",
        name: "photo.png",
        category: "image" as const,
        mimeType: "image/png",
        size: 3,
        localPath: "",
        base64Data: "AQID",
      }],
    };

    await adapter.start(input).completion;

    expect(handle.run).toHaveBeenCalledWith(
      "图片附件：photo.png\nattachmentId: image-1\n回答前请使用 Inspect Image 并传入该 attachmentId 分析这张图片。每张图片只分析一次。\n\nhello",
      "system",
      "context",
      expect.any(Function),
      "high",
      undefined,
      expect.any(Object)
    );
  });

  it("reports Pi initialization failures as runtime unavailable", async () => {
    const bridge = {
      createTurn: vi.fn(async () => {
        throw new Error("Pi package failed to load");
      }),
      disposeAll: vi.fn(),
    } as unknown as PiSessionBridge;
    const adapter = new PiAgentRuntimeAdapter({ sessionBridge: bridge });

    const error = await adapter.start(createInput()).completion.catch((caught) => caught);

    expect(error).toBeInstanceOf(AgentRuntimeNotAvailableError);
    expect(error).toMatchObject({
      agentRuntimeType: "pi",
      reason: "runtime_initialization_failed",
    });
  });

  it("stops and disposes the active Pi turn", async () => {
    let releaseRun: (() => void) | undefined;
    const handle = createMockHandle({
      run: vi.fn(() => new Promise<void>((resolve) => { releaseRun = resolve; })),
      abort: vi.fn(() => releaseRun?.()),
    });
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        createTurn: vi.fn(async () => handle),
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });

    const run = adapter.start(createInput());
    await vi.waitFor(() => expect(handle.run).toHaveBeenCalledOnce());
    await run.abort();

    await expect(run.completion).resolves.toEqual({ status: "stopped" });
    expect(handle.abort).toHaveBeenCalledOnce();
    expect(handle.dispose).toHaveBeenCalledOnce();
  });

  it("does not forward the provider abort error after the user stops", async () => {
    let releaseRun: (() => void) | undefined;
    let emitEvent: ((event: AgentSessionEvent) => void) | undefined;
    const handle = createMockHandle({
      run: vi.fn(
        (_prompt, _system, _context, onEvent) =>
          new Promise<void>((resolve) => {
            emitEvent = onEvent;
            releaseRun = resolve;
          })
      ),
      abort: vi.fn(() => {
        emitEvent?.({
          type: "message_end",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: "This operation was aborted",
          },
        } as AgentSessionEvent);
        emitEvent?.({ type: "agent_end" } as AgentSessionEvent);
        emitEvent?.({ type: "agent_settled" } as AgentSessionEvent);
        releaseRun?.();
      }),
    });
    const forwardEvent = vi.fn();
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        createTurn: vi.fn(async () => handle),
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });

    const run = adapter.start(createInput(forwardEvent));
    await vi.waitFor(() => expect(handle.run).toHaveBeenCalledOnce());
    await run.abort();
    await expect(run.completion).resolves.toEqual({ status: "stopped" });

    expect(forwardEvent).not.toHaveBeenCalledWith({
      type: "agent_error",
      error: "This operation was aborted",
    });
    expect(forwardEvent).toHaveBeenLastCalledWith({
      type: "agent_status",
      status: "stopped",
      source: "desktop",
    });
  });

  it("does not start the Pi prompt when stop is clicked during session initialization", async () => {
    let finishCreateTurn: ((handle: PiSessionHandle) => void) | undefined;
    const handle = createMockHandle();
    const createTurn = vi.fn(
      () => new Promise<PiSessionHandle>((resolve) => { finishCreateTurn = resolve; })
    );
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        createTurn,
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });

    const run = adapter.start(createInput());
    await vi.waitFor(() => expect(createTurn).toHaveBeenCalledOnce());

    await run.abort();
    finishCreateTurn?.(handle);

    await expect(run.completion).resolves.toEqual({ status: "stopped" });
    expect(handle.run).not.toHaveBeenCalled();
    expect(handle.dispose).toHaveBeenCalledOnce();
  });

  it("processes queued messages after the initial run completes", async () => {
    const handle = createMockHandle();
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        createTurn: vi.fn(async () => handle),
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });

    const run = adapter.start(createInput());
    await run.enqueue({ text: "follow up" });

    await expect(run.completion).resolves.toEqual({ status: "completed" });
    expect(handle.followUp).toHaveBeenCalledWith("follow up");
    expect(handle.run).toHaveBeenCalledOnce();
  });

  it("accepts a running-turn guidance message through Pi steer and acknowledges its UUID", async () => {
    let releaseRun: (() => void) | undefined;
    let emitEvent: ((event: AgentSessionEvent) => void) | undefined;
    const handle = createMockHandle({
      run: vi.fn((_prompt, _system, _context, onEvent) => {
        emitEvent = onEvent;
        onEvent({
          type: "message_start",
          message: {
            role: "user",
            content: "hello",
            timestamp: Date.now(),
          },
        } as AgentSessionEvent);
        return new Promise<void>((resolve) => { releaseRun = resolve; });
      }),
      isStreaming: true,
    });
    const forwardEvent = vi.fn();
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        createTurn: vi.fn(async () => handle),
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });

    const run = adapter.start(createInput(forwardEvent));
    await vi.waitFor(() => expect(handle.run).toHaveBeenCalledOnce());
    await run.enqueue({
      id: "guidance-1",
      text: "focus on Shanghai",
      attachments: [{
        id: "guidance-image",
        name: "guidance.png",
        category: "image",
        mimeType: "image/png",
        size: 3,
        localPath: "",
        base64Data: "AQID",
      }],
    });

    expect(handle.steer).toHaveBeenCalledWith(
      "图片附件：guidance.png\nattachmentId: guidance-image\n回答前请使用 Inspect Image 并传入该 attachmentId 分析这张图片。每张图片只分析一次。\n\nfocus on Shanghai"
    );
    expect(handle.markUserMessageConsumed).not.toHaveBeenCalled();
    expect(forwardEvent).toHaveBeenCalledWith({
      type: "queued_message_accepted",
      uuid: "guidance-1",
    });

    emitEvent?.({
      type: "message_start",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: "图片附件：guidance.png\nattachmentId: guidance-image\n回答前请使用 Inspect Image 并传入该 attachmentId 分析这张图片。每张图片只分析一次。\n\nfocus on Shanghai",
          },
        ],
        timestamp: Date.now(),
      },
    } as AgentSessionEvent);

    expect(handle.markUserMessageConsumed).toHaveBeenCalledWith("user-guidance-1");
    expect(forwardEvent).toHaveBeenCalledWith({
      type: "queued_message_started",
      uuid: "guidance-1",
    });
    releaseRun?.();
    await run.completion;
  });

  it("accepts late guidance through Pi followUp when the session is between turns", async () => {
    let releaseRun: (() => void) | undefined;
    const handle = createMockHandle({
      run: vi.fn(() => new Promise<void>((resolve) => { releaseRun = resolve; })),
      isStreaming: false,
    });
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        createTurn: vi.fn(async () => handle),
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });

    const run = adapter.start(createInput());
    await vi.waitFor(() => expect(handle.run).toHaveBeenCalledOnce());
    await run.enqueue({ id: "follow-up-1", text: "continue with news" });

    expect(handle.followUp).toHaveBeenCalledWith("continue with news");
    expect(handle.markUserMessageConsumed).not.toHaveBeenCalled();
    releaseRun?.();
    await run.completion;
  });

  it("acknowledges a retried guidance UUID without delivering it twice", async () => {
    let releaseRun: (() => void) | undefined;
    const handle = createMockHandle({
      run: vi.fn(() => new Promise<void>((resolve) => { releaseRun = resolve; })),
      isStreaming: true,
    });
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        createTurn: vi.fn(async () => handle),
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });
    const run = adapter.start(createInput());
    await vi.waitFor(() => expect(handle.run).toHaveBeenCalledOnce());

    await run.enqueue({ id: "same-guidance", text: "only once" });
    await run.enqueue({ id: "same-guidance", text: "only once" });

    expect(handle.steer).toHaveBeenCalledTimes(1);
    releaseRun?.();
    await run.completion;
  });
});
