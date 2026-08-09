import { AgentExecutionService } from "@/main/agent-execution-service";
import type { AgentRuntimeRouter } from "@/main/runtime";
import type { RuntimeQueryInput, AgentRuntimeHandle } from "@/main/runtime/types";
import type { AgentRequest } from "@/main/agent-profiles";

function createInput(): RuntimeQueryInput {
  return {
    sessionId: "session-1",
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
    toolPolicy: { mode: "default" },
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
    await service.enqueue("session-1", {
      id: "queued-1",
      text: "continue",
      attachments: [queuedImage],
    });
    expect(handle.enqueue).toHaveBeenCalledWith({
      id: "queued-1",
      text: "continue",
      attachments: [queuedImage],
    });

    await service.stop("session-1");
    await execution;
    expect(handle.abort).toHaveBeenCalledOnce();
    expect(service.isRunning("session-1")).toBe(false);
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
});
