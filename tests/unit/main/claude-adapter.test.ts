import { vi } from "vitest";

const { runProductivitySession, sendQueuedMessage, stopAgentForSession } = vi.hoisted(
  () => ({
    runProductivitySession: vi.fn(),
    sendQueuedMessage: vi.fn(),
    stopAgentForSession: vi.fn(),
  })
);

vi.mock("@/main/productivity-runner", () => ({ runProductivitySession }));
vi.mock("@/main/agent", () => ({ sendQueuedMessage, stopAgentForSession }));

import { ClaudeAgentRuntimeAdapter } from "@/main/runtime/claude-adapter";

function createInput(forwardEvent = vi.fn()) {
  return {
    harness: {
      profileId: "productivity" as const,
      sessionId: "session-1",
      workspaceId: "workspace-1",
      prompt: { user: "hello", dynamicContext: "", system: "system" },
      conversation: { messages: [], persistence: "durable" as const },
      workspace: { cwd: "/tmp/project" },
      permissions: { mode: "interactive" as const },
      model: { maxOutputTokens: 16_384, reasoningLevel: "high" as const },
      budget: { maxTurns: 120 },
      output: { incremental: true, visible: true },
    },
    target: {
      agentRuntimeType: "claude" as const,
      provider: {
        id: "provider-1",
        name: "provider",
        providerType: "anthropic" as const,
        baseUrl: "https://example.com",
        apiKey: "key",
        modelId: "model",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      protocol: "anthropic-messages" as const,
      modelId: "model",
    },
    toolGate: { check: vi.fn() },
    source: "desktop" as const,
    forwardEvent,
  };
}

describe("ClaudeAgentRuntimeAdapter", () => {
  it("emits guidance started only when the Claude SDK consumes the queued user message", async () => {
    let forwardRuntimeEvent: ((event: any) => void) | undefined;
    let finishRun: (() => void) | undefined;
    runProductivitySession.mockImplementation(({ forwardEvent }) => {
      forwardRuntimeEvent = forwardEvent;
      forwardEvent({ type: "agent_status", status: "started", source: "desktop" });
      return new Promise<void>((resolve) => { finishRun = resolve; });
    });
    sendQueuedMessage.mockResolvedValue("guidance-1");
    const forwardEvent = vi.fn();
    const run = new ClaudeAgentRuntimeAdapter().start(createInput(forwardEvent));

    await run.enqueue({ id: "guidance-1", text: "new direction" });
    expect(forwardEvent).toHaveBeenCalledWith({
      type: "queued_message_accepted",
      uuid: "guidance-1",
    });
    expect(forwardEvent).not.toHaveBeenCalledWith({
      type: "queued_message_started",
      uuid: "guidance-1",
    });

    forwardRuntimeEvent?.({
      type: "user",
      isReplay: true,
      uuid: "guidance-1",
      message: { role: "user", content: "new direction" },
    });
    expect(forwardEvent).toHaveBeenCalledWith({
      type: "queued_message_started",
      uuid: "guidance-1",
    });

    finishRun?.();
    await run.completion;
  });
});
