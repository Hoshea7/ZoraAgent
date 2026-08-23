import type { AgentRuntimeInput } from "@/main/runtime/types";
import { ProviderModelProbeRunner } from "@/main/provider-model-probe";

type CompletionResult = { status: "completed" | "stopped" };

function createSuccessfulAdapterFactory(capturedInputs: AgentRuntimeInput[]) {
  return () => ({
    start(input: AgentRuntimeInput) {
      capturedInputs.push(input);
      const expectedReply = input.harness.prompt.user.match(/ZORA_PI_PROBE_[A-F0-9]+/)?.[0];
      input.forwardEvent({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: expectedReply }],
        },
      });
      return {
        completion: Promise.resolve<CompletionResult>({ status: "completed" }),
        abort: vi.fn().mockResolvedValue(undefined),
        enqueue: vi.fn().mockResolvedValue(undefined),
      };
    },
    deleteSessionData: vi.fn(),
    dispose: vi.fn(),
  });
}

function createTestInput() {
  return {
    providerId: "provider-1",
    providerName: "Agent Plan OpenAI",
    providerType: "volcengine" as const,
    presetId: "volcengine-agent-plan-openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    apiKey: "sk-test",
    protocol: "openai-completions" as const,
    models: [{ id: "glm-5.2", enabled: true }],
    testRunId: "probe-run",
  };
}

describe("ProviderModelProbeRunner", () => {
  it("uses the production Pi target and runtime request shape", async () => {
    const capturedInputs: AgentRuntimeInput[] = [];
    const runner = new ProviderModelProbeRunner(
      createSuccessfulAdapterFactory(capturedInputs)
    );

    await expect(runner.testModels(createTestInput())).resolves.toEqual({
      success: true,
      results: [{ modelId: "glm-5.2", success: true, message: "连接成功" }],
    });

    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0]).toMatchObject({
      source: "desktop",
      target: {
        agentRuntimeType: "pi",
        provider: {
          id: "provider-1",
          baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
          apiKey: "sk-test",
        },
        protocol: "openai-completions",
        modelId: "glm-5.2",
      },
      harness: {
        prompt: {
          system: expect.stringContaining("Zora"),
          dynamicContext: "runtime_mode=provider_connectivity_probe",
          user: expect.stringContaining("Reply with exactly this text"),
        },
        conversation: { messages: [], persistence: "ephemeral" },
        budget: { maxTurns: 1 },
      },
      toolProvisioningPlan: { tools: [] },
      vision: { visionRelayEnabled: false },
    });
    await expect(
      capturedInputs[0]!.toolGate.authorize({} as never)
    ).resolves.toMatchObject({ behavior: "deny" });
  });

  it("preserves every row result when one model returns invalid content", async () => {
    const capturedInputs: AgentRuntimeInput[] = [];
    let adapterIndex = 0;
    const runner = new ProviderModelProbeRunner(() => ({
      start(input: AgentRuntimeInput) {
        capturedInputs.push(input);
        const currentIndex = adapterIndex++;
        if (currentIndex === 0) {
          const expectedReply = input.harness.prompt.user.match(
            /ZORA_PI_PROBE_[A-F0-9]+/
          )?.[0];
          input.forwardEvent({
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: expectedReply }],
            },
          });
        }
        return {
          completion: Promise.resolve<CompletionResult>({ status: "completed" }),
          abort: vi.fn().mockResolvedValue(undefined),
          enqueue: vi.fn().mockResolvedValue(undefined),
        };
      },
      deleteSessionData: vi.fn(),
      dispose: vi.fn(),
    }));

    const input = createTestInput();
    await expect(
      runner.testModels({
        ...input,
        models: [
          { id: "glm-5.2", enabled: true },
          { id: "invalid-response", enabled: true },
        ],
      })
    ).resolves.toEqual({
      success: false,
      results: [
        { modelId: "glm-5.2", success: true, message: "连接成功" },
        {
          modelId: "invalid-response",
          success: false,
          message: "模型已响应，但未返回预期的测试结果。请重试。",
        },
      ],
    });
  });

  it("aborts every active Pi handle and waits for them to stop", async () => {
    const aborts: Array<ReturnType<typeof vi.fn>> = [];
    const runner = new ProviderModelProbeRunner(() => {
      let resolveCompletion!: (result: CompletionResult) => void;
      const completion = new Promise<CompletionResult>((resolve) => {
        resolveCompletion = resolve;
      });
      const abort = vi.fn(async () => {
        resolveCompletion({ status: "stopped" });
      });
      return {
        start: () => {
          aborts.push(abort);
          return {
            completion,
            abort,
            enqueue: vi.fn().mockResolvedValue(undefined),
          };
        },
        deleteSessionData: vi.fn(),
        dispose: vi.fn(),
      };
    });
    const input = createTestInput();
    const pending = runner.testModels({
      ...input,
      models: [
        { id: "model-a", enabled: true },
        { id: "model-b", enabled: true },
      ],
    });

    await vi.waitFor(() => expect(aborts).toHaveLength(2));
    await expect(runner.cancel(input.testRunId)).resolves.toBe(true);
    await expect(pending).resolves.toEqual({
      success: false,
      results: [
        { modelId: "model-a", success: false, message: "测试已停止" },
        { modelId: "model-b", success: false, message: "测试已停止" },
      ],
    });
    expect(aborts.map((abort) => abort.mock.calls.length)).toEqual([1, 1]);
  });
});
