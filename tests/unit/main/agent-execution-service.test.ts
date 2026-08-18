import { AgentExecutionService } from "@/main/agent-execution-service";
import type { AgentRuntimeRouter } from "@/main/runtime";
import type { RuntimeQueryInput, AgentRuntimeHandle } from "@/main/runtime/types";
import type { AgentRequest } from "@/main/agent-profiles";
import { setPermissionMode } from "@/main/hitl";

function createInput(): RuntimeQueryInput {
  return {
    sessionId: "session-1",
    runId: "run-1",
    workspaceId: "default",
    prompt: "hello",
    forwardEvent: vi.fn(),
    source: "desktop",
    target: {
      agentRuntimeType: "pi",
      protocol: "openai-completions",
      modelId: "model-1",
      provider: {
        id: "provider-1",
        name: "Provider",
        providerType: "custom",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-live",
        modelId: "model-1",
        enabled: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    toolProvisioningPlan: { tools: [] },
    toolProvisioningRequest: {
      sessionId: "session-1",
      workspaceId: "default",
      runtime: "pi",
      source: "desktop",
    },
    vision: {
      imageInputCapability: "unknown",
      visionRelayEnabled: false,
    },
  };
}

describe("AgentExecutionService", () => {
  const profile = {
    prepare: vi.fn(async (input: { sessionId: string; workspaceId: string; prompt: string }): Promise<AgentRequest> => ({
      profileId: "productivity",
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      prompt: { user: input.prompt, dynamicContext: "", system: "system" },
      conversation: { messages: [], persistence: "durable" },
      workspace: { cwd: "/tmp/project" },
      permissions: { mode: "interactive" },
      model: { maxOutputTokens: 16_384, reasoningLevel: "high" },
      budget: { maxTurns: 120 },
      output: { incremental: true, visible: true },
    })),
  };

  it("owns running state, queue delivery and stop for the selected runtime", async () => {
    let finish: ((value: { status: "stopped" }) => void) | undefined;
    const handle: AgentRuntimeHandle = {
      completion: new Promise((resolve) => { finish = resolve; }),
      abort: vi.fn(async () => finish?.({ status: "stopped" })),
      enqueue: vi.fn(async () => undefined),
    };
    const runtimes = {
      start: vi.fn(() => handle),
      dispose: vi.fn(),
    } as unknown as AgentRuntimeRouter;
    const service = new AgentExecutionService(runtimes, profile as never);

    const execution = service.execute(createInput());
    expect(service.getRunInfo("session-1")).toEqual({
      running: true,
      runId: "run-1",
      source: "desktop",
      agentRuntimeType: "pi",
    });

    const queuedImage = {
      id: "queued-image",
      name: "guidance.png",
      category: "image" as const,
      mimeType: "image/png",
      size: 3,
      localPath: "",
      base64Data: "AQID",
    };
    await service.enqueue("session-1", "run-1", {
      id: "queued-1",
      text: "continue",
      attachments: [queuedImage],
    });
    expect(handle.enqueue).toHaveBeenCalledWith({
      id: "queued-1",
      text: "continue",
      attachments: [queuedImage],
    });

    await service.stop("session-1", "run-1");
    expect(handle.abort).toHaveBeenCalledOnce();
    expect(service.isRunning("session-1")).toBe(false);
    await execution;
  });

  it("rejects a second run for the same session", async () => {
    let finish: (() => void) | undefined;
    const handle: AgentRuntimeHandle = {
      completion: new Promise((resolve) => { finish = () => resolve({ status: "completed" }); }),
      abort: vi.fn(),
      enqueue: vi.fn(),
    };
    const service = new AgentExecutionService({
      start: () => handle,
      dispose: vi.fn(),
    } as unknown as AgentRuntimeRouter, profile as never);

    const first = service.execute(createInput());
    await expect(service.execute(createInput())).rejects.toThrow("already running");
    finish?.();
    await first;
  });

  it("waits for settlement when stop is requested more than once", async () => {
    let finish: (() => void) | undefined;
    const handle: AgentRuntimeHandle = {
      completion: new Promise((resolve) => {
        finish = () => resolve({ status: "stopped" });
      }),
      abort: vi.fn(async () => undefined),
      enqueue: vi.fn(),
    };
    const runtimes = {
      start: vi.fn(() => handle),
      dispose: vi.fn(),
    } as unknown as AgentRuntimeRouter;
    const service = new AgentExecutionService(runtimes, profile as never);
    const execution = service.execute(createInput());
    await vi.waitFor(() => expect(runtimes.start).toHaveBeenCalledOnce());

    const firstStop = service.stop("session-1", "run-1");
    const secondStop = service.stop("session-1", "run-1");
    let secondResolved = false;
    void secondStop.then(() => {
      secondResolved = true;
    });
    await Promise.resolve();

    expect(secondResolved).toBe(false);
    expect(handle.abort).toHaveBeenCalledOnce();
    finish?.();
    await Promise.all([firstStop, secondStop, execution]);
    expect(service.isRunning("session-1")).toBe(false);
  });

  it("returns the runtime outcome and the final assistant text", async () => {
    const handle: AgentRuntimeHandle = {
      completion: Promise.resolve({
        status: "completed",
        finalText: "Child task result",
        runtimeSessionId: "runtime-1",
      }),
      abort: vi.fn(),
      enqueue: vi.fn(),
    };
    const service = new AgentExecutionService(
      { start: () => handle, dispose: vi.fn() } as unknown as AgentRuntimeRouter,
      profile as never,
      vi.fn(async () => undefined)
    );

    await expect(service.execute(createInput())).resolves.toEqual({
      status: "completed",
      finalText: "Child task result",
      runtimeSessionId: "runtime-1",
    });
  });

  it("adds the run id to permission events emitted by the tool gate", async () => {
    setPermissionMode("ask", "session-1");
    let finish: (() => void) | undefined;
    const handle: AgentRuntimeHandle = {
      completion: new Promise((resolve) => {
        finish = () => resolve({ status: "completed" });
      }),
      abort: vi.fn(),
      enqueue: vi.fn(),
    };
    const start = vi.fn(() => handle);
    const service = new AgentExecutionService(
      { start, dispose: vi.fn() } as unknown as AgentRuntimeRouter,
      profile as never
    );
    const input = createInput();
    const execution = service.execute(input);
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    const runtimeInput = start.mock.calls[0]?.[0];
    const controller = new AbortController();
    const decision = runtimeInput!.toolGate.authorize({
      tool: "Bash",
      input: { command: "node -e \"console.log('permission')\"" },
      callId: "tool-call-1",
      signal: controller.signal,
    });

    await vi.waitFor(() =>
      expect(input.forwardEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "permission_request",
          runId: "run-1",
        })
      )
    );
    controller.abort();
    await decision.catch(() => undefined);
    finish?.();
    await execution;
  });

  it("runs manual compaction outside the Agent turn lifecycle", async () => {
    const start = vi.fn();
    const compact = vi.fn(async () => ({
      status: "not_needed" as const,
      message: "当前上下文无需压缩",
    }));
    const onConversationEnd = vi.fn(async () => undefined);
    const service = new AgentExecutionService(
      { start, compact, dispose: vi.fn() } as unknown as AgentRuntimeRouter,
      profile as never,
      onConversationEnd
    );

    await expect(service.compact(createInput())).resolves.toEqual({
      status: "not_needed",
      message: "当前上下文无需压缩",
    });

    expect(compact).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    expect(onConversationEnd).not.toHaveBeenCalled();
    expect(service.isRunning("session-1")).toBe(false);
  });
});
