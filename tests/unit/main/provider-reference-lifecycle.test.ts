import path from "node:path";
import type { DefaultModelSettings } from "@/shared/types/default-model";
import type { MemorySettings } from "@/shared/types/memory";
import type { VisionSettings } from "@/shared/types/vision";

const defaultModelModuleId = path.resolve(
  process.cwd(),
  "src/main/default-model-settings.ts"
);
const memoryModuleId = path.resolve(process.cwd(), "src/main/memory-settings.ts");
const visionModuleId = path.resolve(process.cwd(), "src/main/vision-settings.ts");

async function loadLifecycleModule(input: {
  defaultModel: DefaultModelSettings;
  memory: MemorySettings;
  vision: VisionSettings;
}) {
  vi.resetModules();
  const saveDefaultModelSettings = vi.fn().mockResolvedValue(undefined);
  const saveMemorySettings = vi.fn().mockResolvedValue(undefined);
  const saveVisionSettings = vi.fn().mockResolvedValue(undefined);

  vi.doMock(defaultModelModuleId, () => ({
    loadDefaultModelSettings: vi.fn().mockResolvedValue(input.defaultModel),
    saveDefaultModelSettings,
  }));
  vi.doMock(memoryModuleId, () => ({
    loadMemorySettings: vi.fn().mockResolvedValue(input.memory),
    saveMemorySettings,
  }));
  vi.doMock(visionModuleId, () => ({
    visionSettingsStore: {
      load: vi.fn().mockResolvedValue(input.vision),
      save: saveVisionSettings,
    },
  }));

  return {
    ...(await import("@/main/provider-reference-lifecycle")),
    saveDefaultModelSettings,
    saveMemorySettings,
    saveVisionSettings,
  };
}

afterEach(() => {
  vi.doUnmock(defaultModelModuleId);
  vi.doUnmock(memoryModuleId);
  vi.doUnmock(visionModuleId);
  vi.resetModules();
});

describe("provider reference lifecycle", () => {
  it("reports only whether the exact model is actively used", async () => {
    const { getProviderReferenceImpact } = await loadLifecycleModule({
      defaultModel: {
        defaultProviderId: "provider-1",
        defaultModelId: "model-a",
      },
      memory: {
        enabled: true,
        mode: "immediate",
        batchIdleMinutes: 30,
        memoryProviderId: null,
        memoryModelId: null,
      },
      vision: {
        relay: { enabled: true, providerId: "provider-1", modelId: "model-b" },
        capabilityOverrides: [],
      },
    });

    await expect(
      getProviderReferenceImpact({ providerId: "provider-1", modelIds: ["model-a"] })
    ).resolves.toEqual({ inUse: true });
    await expect(
      getProviderReferenceImpact({ providerId: "provider-1", modelIds: ["model-c"] })
    ).resolves.toEqual({ inUse: false });
  });

  it("clears default and memory references and disables an exact vision relay", async () => {
    const lifecycle = await loadLifecycleModule({
      defaultModel: {
        defaultProviderId: "provider-1",
        defaultModelId: "model-a",
      },
      memory: {
        enabled: true,
        mode: "batch",
        batchIdleMinutes: 30,
        memoryProviderId: "provider-1",
        memoryModelId: "model-a",
      },
      vision: {
        relay: { enabled: true, providerId: "provider-1", modelId: "model-a" },
        capabilityOverrides: [
          { providerId: "provider-1", modelId: "model-a", capability: "supported" },
          { providerId: "provider-2", modelId: "model-b", capability: "unsupported" },
        ],
      },
    });

    await lifecycle.reconcileDeletedProviderReference({
      providerId: "provider-1",
      modelIds: ["model-a"],
    });

    expect(lifecycle.saveDefaultModelSettings).toHaveBeenCalledWith({
      defaultProviderId: null,
      defaultModelId: null,
    });
    expect(lifecycle.saveMemorySettings).toHaveBeenCalledWith({
      enabled: true,
      mode: "batch",
      batchIdleMinutes: 30,
      memoryProviderId: null,
      memoryModelId: null,
    });
    expect(lifecycle.saveVisionSettings).toHaveBeenCalledWith({
      relay: { enabled: false },
      capabilityOverrides: [
        { providerId: "provider-2", modelId: "model-b", capability: "unsupported" },
      ],
    });
  });

  it("removes every reference owned by a deleted Provider", async () => {
    const lifecycle = await loadLifecycleModule({
      defaultModel: {
        defaultProviderId: "provider-1",
        defaultModelId: "model-a",
      },
      memory: {
        enabled: true,
        mode: "manual",
        batchIdleMinutes: 30,
        memoryProviderId: "provider-1",
        memoryModelId: "model-b",
      },
      vision: {
        relay: { enabled: true, providerId: "provider-1", modelId: "model-c" },
        capabilityOverrides: [
          { providerId: "provider-1", modelId: "model-d", capability: "supported" },
        ],
      },
    });

    await lifecycle.reconcileDeletedProviderReference({ providerId: "provider-1" });

    expect(lifecycle.saveDefaultModelSettings).toHaveBeenCalledTimes(1);
    expect(lifecycle.saveMemorySettings).toHaveBeenCalledTimes(1);
    expect(lifecycle.saveVisionSettings).toHaveBeenCalledWith({
      relay: { enabled: false },
      capabilityOverrides: [],
    });
  });
});
