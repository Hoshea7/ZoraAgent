import { registerProviderIpcHandlers } from "@/main/provider-ipc";
import { PROVIDER_IPC } from "@/shared/types/provider-ipc";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function createHarness() {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  } as unknown as Parameters<typeof registerProviderIpcHandlers>[0];
  const dependencies = {
    testModels: vi.fn().mockResolvedValue({ success: true, results: [] }),
    fetchModels: vi.fn().mockResolvedValue([{ id: "model-a", enabled: false }]),
    cancelTest: vi.fn().mockResolvedValue(true),
    getReferenceImpact: vi.fn().mockResolvedValue({ inUse: true }),
  };

  registerProviderIpcHandlers(ipcMain, dependencies);
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
    return handler({}, ...args);
  };

  return { dependencies, handlers, invoke };
}

describe("Provider IPC integration", () => {
  it("registers the four Provider feature channels and forwards a validated model test", async () => {
    const { dependencies, handlers, invoke } = createHarness();

    expect([...handlers.keys()]).toEqual(Object.values(PROVIDER_IPC));
    await expect(
      invoke(PROVIDER_IPC.TEST_MODELS, {
        providerId: " provider-1 ",
        providerName: " Provider A ",
        presetId: "volcengine-agent-plan-openai",
        baseUrl: " https://provider.test/v1 ",
        apiKey: " secret ",
        models: [{ id: " model-a ", enabled: true }],
        testRunId: " run-1 ",
        protocol: "openai-completions",
        providerType: "volcengine",
      })
    ).resolves.toEqual({ success: true, results: [] });
    expect(dependencies.testModels).toHaveBeenCalledWith({
      providerId: "provider-1",
      providerName: "Provider A",
      presetId: "volcengine-agent-plan-openai",
      baseUrl: "https://provider.test/v1",
      apiKey: "secret",
      models: [{ id: "model-a", enabled: true }],
      testRunId: "run-1",
      protocol: "openai-completions",
      providerType: "volcengine",
    });

    await expect(
      invoke(PROVIDER_IPC.TEST_MODELS, {
        presetId: "custom",
        baseUrl: "https://provider.test/v1",
        apiKey: "secret",
        models: [],
        testRunId: "run-2",
        protocol: "unsupported",
        providerType: "custom",
      })
    ).rejects.toThrow("supported provider protocol");

    await expect(
      invoke(PROVIDER_IPC.TEST_MODELS, {
        presetId: "anthropic",
        baseUrl: "https://provider.test/v1",
        apiKey: "secret",
        models: [{ id: "model-a", enabled: true }],
        testRunId: "run-3",
        protocol: "openai-completions",
        providerType: "anthropic",
      })
    ).rejects.toThrow("protocol does not match");
    expect(dependencies.testModels).toHaveBeenCalledTimes(1);
  });

  it("forwards discovery, reference inspection, and cancellation without local fallbacks", async () => {
    const { dependencies, invoke } = createHarness();

    await expect(
      invoke(PROVIDER_IPC.FETCH_MODELS, {
        presetId: "custom",
        providerType: "custom",
        protocol: "openai-completions",
        baseUrl: "https://provider.test/v1",
        apiKey: "secret",
      })
    ).resolves.toEqual([{ id: "model-a", enabled: false }]);
    expect(dependencies.fetchModels).toHaveBeenCalledWith({
      presetId: "custom",
      providerType: "custom",
      protocol: "openai-completions",
      baseUrl: "https://provider.test/v1",
      apiKey: "secret",
    });

    await expect(
      invoke(PROVIDER_IPC.GET_REFERENCE_IMPACT, " provider-1 ", " model-a ")
    ).resolves.toEqual({ inUse: true });
    expect(dependencies.getReferenceImpact).toHaveBeenCalledWith({
      providerId: "provider-1",
      modelIds: ["model-a"],
    });

    await expect(invoke(PROVIDER_IPC.CANCEL_TEST, " run-1 ")).resolves.toBe(true);
    expect(dependencies.cancelTest).toHaveBeenCalledWith("run-1");
  });
});
