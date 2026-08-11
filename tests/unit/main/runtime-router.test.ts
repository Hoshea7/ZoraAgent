import { AgentRuntimeRouter } from "@/main/runtime/runtime-router";
import type { AgentRuntimeAdapter } from "@/main/runtime/types";
import type { AgentRuntimeTarget } from "@/main/runtime/runtime-execution-target";
import type { AgentRequest } from "@/main/agent-profiles";

function createTarget(
  agentRuntimeType: "claude" | "pi"
): AgentRuntimeTarget {
  return {
    agentRuntimeType,
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
  };
}

describe("AgentRuntimeRouter", () => {
  const harness: AgentRequest = {
    profileId: "productivity",
    sessionId: "session-1",
    workspaceId: "default",
    prompt: { user: "hello", dynamicContext: "", system: "system" },
    conversation: { messages: [], persistence: "durable" },
    workspace: { cwd: "/tmp/project" },
    permissions: { mode: "interactive" },
    model: { maxOutputTokens: 16_384, reasoningLevel: "high" },
      budget: { maxTurns: 120 },
    output: { incremental: true, visible: true },
  };
  const createHandle = () => ({
    completion: Promise.resolve({ status: "completed" as const }),
    abort: vi.fn(),
    enqueue: vi.fn(),
  });

  it("logs the runtime used to dispatch a query", () => {
    const router = new AgentRuntimeRouter();
    const start = vi.fn().mockReturnValue(createHandle());
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    router.registerAdapter({
      type: "pi",
      start,
      dispose: vi.fn(),
      deleteSessionData: vi.fn(),
    } satisfies AgentRuntimeAdapter);

    router.start({
      harness,
      forwardEvent: vi.fn(),
      source: "desktop",
      target: createTarget("pi"),
    });

    expect(info).toHaveBeenCalledWith(
      '[agent][runtime-router][dispatch] Runtime 已分发 sessionId="session-1" workspaceId="default" agentRuntimeType="pi" providerId="provider-1" selectedModelId="model-1"'
    );
  });

  it("routes each query from its resolved execution target", () => {
    const router = new AgentRuntimeRouter();
    const piStart = vi.fn().mockReturnValue(createHandle());
    const claudeStart = vi.fn().mockReturnValue(createHandle());
    router.registerAdapter({
      type: "pi",
      start: piStart,
      dispose: vi.fn(),
      deleteSessionData: vi.fn(),
    });
    router.registerAdapter({
      type: "claude",
      start: claudeStart,
      dispose: vi.fn(),
      deleteSessionData: vi.fn(),
    });
    const commonInput = {
      harness,
      forwardEvent: vi.fn(),
      source: "desktop" as const,
    };

    router.start({ ...commonInput, target: createTarget("pi") });
    router.start({ ...commonInput, target: createTarget("claude") });

    expect(piStart).toHaveBeenCalledOnce();
    expect(claudeStart).toHaveBeenCalledOnce();
  });

  it("rejects manual compaction when the runtime has no compaction capability", () => {
    const router = new AgentRuntimeRouter();
    router.registerAdapter({
      type: "claude",
      start: vi.fn().mockReturnValue(createHandle()),
      dispose: vi.fn(),
      deleteSessionData: vi.fn(),
    });

    expect(() =>
      router.compact({
        harness,
        forwardEvent: vi.fn(),
        source: "desktop",
        target: createTarget("claude"),
      })
    ).toThrow("当前 Runtime 暂不支持手动压缩。");
  });

  it("deletes derived session data from every runtime", () => {
    const router = new AgentRuntimeRouter();
    const piDelete = vi.fn();
    const claudeDelete = vi.fn();
    router.registerAdapter({
      type: "pi",
      start: vi.fn(),
      dispose: vi.fn(),
      deleteSessionData: piDelete,
    });
    router.registerAdapter({
      type: "claude",
      start: vi.fn(),
      dispose: vi.fn(),
      deleteSessionData: claudeDelete,
    });

    router.deleteSessionData("session-1", "workspace-1");

    expect(piDelete).toHaveBeenCalledWith("session-1", "workspace-1");
    expect(claudeDelete).toHaveBeenCalledWith("session-1", "workspace-1");
  });
});
