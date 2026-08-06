import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { PiRuntimeAdapter } from "@/main/runtime/pi-adapter";
import type { PiSessionHandle } from "@/main/runtime/pi-session-bridge";
import { PiSessionBridge } from "@/main/runtime/pi-session-bridge";
import { RuntimeNotAvailableError } from "@/main/runtime/types";
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
    isDefault: true,
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
      limits: { maxTurns: 120, maxOutputTokens: 16_384, reasoningEffort: "medium" },
      output: { incremental: true, visible: true },
    },
    forwardEvent,
    target: {
      runtimeType: "pi" as const,
      provider: { ...createProvider(), apiKey: "sk-live" },
      protocol: "openai-completions" as const,
      modelId: "gpt-5-mini",
    },
    source: "desktop" as const,
  };
}

describe("PiRuntimeAdapter", () => {
  it("runs a Pi session and forwards mapped events", async () => {
    const handle: PiSessionHandle = {
      replaceHistory: vi.fn(),
      run: vi.fn(async (_prompt, _system, _context, onEvent) => {
        onEvent({
          type: "tool_execution_start",
          toolCallId: "tool-1",
          toolName: "read",
          args: { path: "package.json" },
        } satisfies AgentEvent);
      }),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    const bridge = new PiSessionBridge(async () => handle);
    const forwardEvent = vi.fn();
    const adapter = new PiRuntimeAdapter({
      sessionBridge: bridge,
    });

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
    expect(handle.replaceHistory).toHaveBeenCalledWith([]);
  });

  it("reports Pi initialization failures as runtime unavailable", async () => {
    const bridge = new PiSessionBridge(async () => {
      throw new Error("Pi package failed to load");
    });
    const adapter = new PiRuntimeAdapter({ sessionBridge: bridge });

    const error = await adapter.start(createInput()).completion.catch((caught) => caught);

    expect(error).toBeInstanceOf(RuntimeNotAvailableError);
    expect(error).toMatchObject({
      runtimeType: "pi",
      reason: "runtime_initialization_failed",
    });
  });

  it("stops the active turn without disposing the Pi conversation", async () => {
    let releaseRun: (() => void) | undefined;
    const handle: PiSessionHandle = {
      replaceHistory: vi.fn(),
      run: vi.fn(() => new Promise<void>((resolve) => { releaseRun = resolve; })),
      abort: vi.fn(() => releaseRun?.()),
      dispose: vi.fn(),
    };
    const adapter = new PiRuntimeAdapter({
      sessionBridge: new PiSessionBridge(async () => handle),
    });

    const run = adapter.start(createInput());
    await vi.waitFor(() => expect(handle.run).toHaveBeenCalledOnce());
    await run.abort();

    await expect(run.completion).resolves.toEqual({ status: "stopped" });
    expect(handle.abort).toHaveBeenCalledOnce();
    expect(handle.dispose).not.toHaveBeenCalled();
  });
});
