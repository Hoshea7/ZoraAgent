import { RuntimeRouter } from "@/main/runtime/runtime-router";
import type { RuntimeAdapter } from "@/main/runtime/types";
import type { RuntimeExecutionTarget } from "@/main/runtime/runtime-execution-target";
import type { AgentHarnessSpec } from "@/main/agent-profiles";

function createTarget(
  runtimeType: "claude" | "pi"
): RuntimeExecutionTarget {
  return {
    runtimeType,
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

describe("RuntimeRouter", () => {
  const harness: AgentHarnessSpec = {
    profileId: "productivity",
    sessionId: "session-1",
    workspaceId: "default",
    prompt: { user: "hello", dynamicContext: "", system: "system" },
    conversation: { messages: [], persistence: "durable" },
    workspace: { cwd: "/tmp/project" },
    permissions: { mode: "interactive" },
    limits: { maxTurns: 120, maxOutputTokens: 16_384, reasoningEffort: "medium" },
    output: { incremental: true, visible: true },
  };
  const createHandle = () => ({
    completion: Promise.resolve({ status: "completed" as const }),
    abort: vi.fn(),
    enqueue: vi.fn(),
  });

  it("logs the runtime used to dispatch a query", () => {
    const router = new RuntimeRouter();
    const start = vi.fn().mockReturnValue(createHandle());
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    router.registerAdapter({
      type: "pi",
      start,
      dispose: vi.fn(),
    } satisfies RuntimeAdapter);

    router.start({
      harness,
      forwardEvent: vi.fn(),
      source: "desktop",
      target: createTarget("pi"),
    });

    expect(info).toHaveBeenCalledWith(
      '[agent][runtime-router][dispatch] Runtime 已分发 sessionId="session-1" workspaceId="default" runtimeType="pi" providerId="provider-1" selectedModelId="model-1"'
    );
  });

  it("routes each query from its resolved execution target", () => {
    const router = new RuntimeRouter();
    const piStart = vi.fn().mockReturnValue(createHandle());
    const claudeStart = vi.fn().mockReturnValue(createHandle());
    router.registerAdapter({
      type: "pi",
      start: piStart,
      dispose: vi.fn(),
    });
    router.registerAdapter({
      type: "claude",
      start: claudeStart,
      dispose: vi.fn(),
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
});
