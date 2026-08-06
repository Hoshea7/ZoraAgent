import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

vi.mock("@/main/runtime/pi-mcp-bridge", () => ({
  createPiMcpTools: vi.fn(async () => []),
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
      limits: { maxTurns: 120, maxOutputTokens: 16_384, reasoningLevel: "medium" },
      output: { incremental: true, visible: true },
    },
    forwardEvent,
    target: {
      agentRuntimeType: "pi" as const,
      provider: { ...createProvider(), apiKey: "sk-live" },
      protocol: "openai-completions" as const,
      modelId: "gpt-5-mini",
    },
    source: "desktop" as const,
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
    dispose: vi.fn(),
    ...overrides,
  };
}

describe("PiAgentRuntimeAdapter", () => {
  it("runs a Pi session and forwards mapped events", async () => {
    const handle = createMockHandle();
    const bridge = {
      getOrCreateAgent: vi.fn(async () => handle),
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

  it("reports Pi initialization failures as runtime unavailable", async () => {
    const bridge = {
      getOrCreateAgent: vi.fn(async () => {
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

  it("stops the active turn without disposing the Pi conversation", async () => {
    let releaseRun: (() => void) | undefined;
    const handle = createMockHandle({
      run: vi.fn(() => new Promise<void>((resolve) => { releaseRun = resolve; })),
      abort: vi.fn(() => releaseRun?.()),
    });
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        getOrCreateAgent: vi.fn(async () => handle),
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });

    const run = adapter.start(createInput());
    await vi.waitFor(() => expect(handle.run).toHaveBeenCalledOnce());
    await run.abort();

    await expect(run.completion).resolves.toEqual({ status: "stopped" });
    expect(handle.abort).toHaveBeenCalledOnce();
    expect(handle.dispose).not.toHaveBeenCalled();
  });

  it("processes queued messages after the initial run completes", async () => {
    const handle = createMockHandle();
    const adapter = new PiAgentRuntimeAdapter({
      sessionBridge: {
        getOrCreateAgent: vi.fn(async () => handle),
        disposeAll: vi.fn(),
      } as unknown as PiSessionBridge,
    });

    const run = adapter.start(createInput());
    await run.enqueue({ text: "follow up" });

    await expect(run.completion).resolves.toEqual({ status: "completed" });
    expect(handle.run).toHaveBeenCalledTimes(2);
  });
});
