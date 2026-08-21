import path from "node:path";

const providerManagerModuleId = path.resolve(
  process.cwd(),
  "src/main/provider-manager.ts"
);
const memorySettingsModuleId = path.resolve(
  process.cwd(),
  "src/main/memory-settings.ts"
);
const defaultModelSettingsModuleId = path.resolve(
  process.cwd(),
  "src/main/default-model-settings.ts"
);

async function loadSdkEnv(options: {
  memoryProviderId?: string | null;
  memoryModelId?: string | null;
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
}) {
  vi.resetModules();
  const getProviderByIdWithKey = vi.fn().mockResolvedValue(null);
  vi.doMock(providerManagerModuleId, () => ({
    providerManager: { getProviderByIdWithKey },
    buildProviderSdkEnv: vi.fn(),
  }));
  vi.doMock(memorySettingsModuleId, () => ({
    loadMemorySettings: vi.fn().mockResolvedValue({
      memoryProviderId: options.memoryProviderId ?? null,
      memoryModelId: options.memoryModelId ?? null,
    }),
  }));
  vi.doMock(defaultModelSettingsModuleId, () => ({
    loadDefaultModelSettings: vi.fn().mockResolvedValue({
      defaultProviderId: options.defaultProviderId ?? null,
      defaultModelId: options.defaultModelId ?? null,
    }),
    resolveDefaultModelTarget: vi.fn().mockResolvedValue(null),
  }));

  return {
    module: await import("@/main/query-profiles/sdk-env"),
    getProviderByIdWithKey,
  };
}

afterEach(() => {
  vi.doUnmock(providerManagerModuleId);
  vi.doUnmock(memorySettingsModuleId);
  vi.doUnmock(defaultModelSettingsModuleId);
  vi.resetModules();
});

describe("query profile model selection", () => {
  it("rejects a missing explicit memory Provider without using the default target", async () => {
    const { module } = await loadSdkEnv({
      memoryProviderId: "missing-memory-provider",
      memoryModelId: "memory-model",
      defaultProviderId: "default-provider",
      defaultModelId: "default-model",
    });

    await expect(module.resolveSdkEnvForProfile("memory")).rejects.toThrow(
      "MEMORY_PROVIDER_NOT_FOUND:missing-memory-provider"
    );
  });

  it("rejects an invalid explicit default target without using process environment models", async () => {
    const { module } = await loadSdkEnv({
      defaultProviderId: "configured-provider",
      defaultModelId: "missing-model",
    });

    await expect(module.resolveSdkEnvForProfile("productivity")).rejects.toThrow(
      "MODEL_NOT_CONFIGURED:missing-model"
    );
  });
});
