import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProviderCreateInput } from "@/shared/types/provider";

const tempHomes = new Set<string>();

function createTempHome() {
  const homeDir = mkdtempSync(path.join(tmpdir(), "zora-provider-int-"));
  tempHomes.add(homeDir);
  return homeDir;
}

function createProviderInput(overrides: Partial<ProviderCreateInput> = {}): ProviderCreateInput {
  return {
    name: "Anthropic Primary",
    providerType: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-test-1",
    models: [{ id: "claude-sonnet-4", enabled: true }],
    ...overrides,
  };
}

async function loadProviderRuntime(homeDir: string) {
  vi.resetModules();

  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
      ...actual,
      homedir: () => homeDir,
    };
  });

  return {
    providerManagerModule: await import("@/main/provider-manager"),
    defaultModelSettingsModule: await import("@/main/default-model-settings"),
    memorySettingsModule: await import("@/main/memory-settings"),
    visionSettingsModule: await import("@/main/vision-settings"),
    providerConfigurationModule: await import("@/main/provider-configuration-service"),
  };
}

afterEach(() => {
  vi.doUnmock("node:os");
  vi.resetModules();

  for (const homeDir of tempHomes) {
    rmSync(homeDir, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("integration provider lifecycle", () => {
  it("persists connection details without models and restores them after reload", async () => {
    const homeDir = createTempHome();
    const firstLoad = await loadProviderRuntime(homeDir);
    const created = await firstLoad.providerManagerModule.providerManager.create(
      createProviderInput({ models: [] })
    );

    const secondLoad = await loadProviderRuntime(homeDir);
    await expect(secondLoad.providerManagerModule.providerManager.list()).resolves.toEqual([
      expect.objectContaining({ id: created.id, enabled: true, models: [] }),
    ]);
    const configured = await secondLoad.providerManagerModule.providerManager.create(
      createProviderInput({ name: "Configured", apiKey: "sk-configured" })
    );
    await expect(
      secondLoad.providerManagerModule.providerManager.getDefaultProviderWithKey()
    ).resolves.toEqual(
      expect.objectContaining({
        apiKey: "sk-configured",
        provider: expect.objectContaining({ id: configured.id }),
      })
    );
  });

  it("pauses and resumes a Provider without changing model states", async () => {
    const homeDir = createTempHome();
    const firstLoad = await loadProviderRuntime(homeDir);
    const created = await firstLoad.providerManagerModule.providerManager.create(
      createProviderInput({
        models: [
          { id: "claude-sonnet-4", enabled: true },
          { id: "claude-haiku-4", enabled: false },
        ],
      })
    );

    await firstLoad.providerManagerModule.providerManager.update(created.id, {
      enabled: false,
    });
    const secondLoad = await loadProviderRuntime(homeDir);
    const paused = (await secondLoad.providerManagerModule.providerManager.list())[0]!;
    expect(paused).toMatchObject({
      enabled: false,
      models: [
        { id: "claude-sonnet-4", enabled: true },
        { id: "claude-haiku-4", enabled: false },
      ],
    });

    await secondLoad.providerManagerModule.providerManager.update(created.id, {
      enabled: true,
    });
    await expect(secondLoad.providerManagerModule.providerManager.list()).resolves.toEqual([
      expect.objectContaining({ enabled: true, models: paused.models }),
    ]);
  });

  it("creates a provider, persists it, and restores it after reload", async () => {
    const homeDir = createTempHome();
    const firstLoad = await loadProviderRuntime(homeDir);

    const created = await firstLoad.providerManagerModule.providerManager.create(
      createProviderInput({
        apiKey: "sk-persisted",
      })
    );

    await expect(firstLoad.providerManagerModule.providerManager.list()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        name: "Anthropic Primary",
        apiKey: "••••••",
      }),
    ]);

    const secondLoad = await loadProviderRuntime(homeDir);
    await expect(secondLoad.providerManagerModule.providerManager.list()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        name: "Anthropic Primary",
      }),
    ]);
    await expect(
      secondLoad.providerManagerModule.providerManager.getProviderByIdWithKey(created.id)
    ).resolves.toEqual(
      expect.objectContaining({
        apiKey: "sk-persisted",
        provider: expect.objectContaining({
          id: created.id,
          name: "Anthropic Primary",
        }),
      })
    );
  });

  it("persists the exact default model target across reloads", async () => {
    const homeDir = createTempHome();
    const firstLoad = await loadProviderRuntime(homeDir);

    await firstLoad.providerManagerModule.providerManager.create(
      createProviderInput({
        name: "Provider A",
        apiKey: "sk-a",
      })
    );
    const providerB = await firstLoad.providerManagerModule.providerManager.create(
      createProviderInput({
        name: "Provider B",
        apiKey: "sk-b",
      })
    );

    await firstLoad.defaultModelSettingsModule.saveDefaultModelSettings({
      defaultProviderId: providerB.id,
      defaultModelId: "claude-sonnet-4",
    });

    const secondLoad = await loadProviderRuntime(homeDir);
    await expect(
      secondLoad.defaultModelSettingsModule.resolveDefaultModelTarget()
    ).resolves.toEqual(
      expect.objectContaining({
        apiKey: "sk-b",
        selectedModelId: "claude-sonnet-4",
        provider: expect.objectContaining({
          id: providerB.id,
        }),
      })
    );
  });

  it("deletes the only provider without breaking subsequent operations", async () => {
    const homeDir = createTempHome();
    const { providerManagerModule } = await loadProviderRuntime(homeDir);

    const created = await providerManagerModule.providerManager.create(createProviderInput());
    await providerManagerModule.providerManager.delete(created.id);

    await expect(providerManagerModule.providerManager.list()).resolves.toEqual([]);
    await expect(providerManagerModule.providerManager.getDefaultProviderWithKey()).resolves.toBe(
      null
    );
    await expect(providerManagerModule.providerManager.hasConfigured()).resolves.toBe(false);
  });

  it("cleans default, memory, and vision references when a configured model is deleted", async () => {
    const homeDir = createTempHome();
    const runtime = await loadProviderRuntime(homeDir);
    const created = await runtime.providerManagerModule.providerManager.create(
      createProviderInput({
        models: [
          { id: "claude-haiku-4", enabled: true },
          { id: "claude-sonnet-4", enabled: true },
          { id: "claude-opus-4", enabled: true },
        ],
      })
    );
    await runtime.defaultModelSettingsModule.saveDefaultModelSettings({
      defaultProviderId: created.id,
      defaultModelId: "claude-sonnet-4",
    });
    await runtime.memorySettingsModule.saveMemorySettings({
      enabled: true,
      mode: "immediate",
      batchIdleMinutes: 30,
      memoryProviderId: created.id,
      memoryModelId: "claude-sonnet-4",
    });
    await runtime.visionSettingsModule.visionSettingsStore.save({
      relay: {
        enabled: true,
        providerId: created.id,
        modelId: "claude-sonnet-4",
      },
      capabilityOverrides: [
        {
          providerId: created.id,
          modelId: "claude-sonnet-4",
          capability: "supported",
        },
      ],
    });

    await runtime.providerConfigurationModule.updateProviderConfiguration(created.id, {
      models: [{ id: "claude-opus-4", enabled: true }],
    });

    const reloaded = await loadProviderRuntime(homeDir);
    await expect(
      reloaded.defaultModelSettingsModule.loadDefaultModelSettings()
    ).resolves.toEqual({ defaultProviderId: null, defaultModelId: null });
    await expect(reloaded.memorySettingsModule.loadMemorySettings()).resolves.toMatchObject({
      memoryProviderId: null,
      memoryModelId: null,
    });
    await expect(reloaded.visionSettingsModule.visionSettingsStore.load()).resolves.toEqual({
      relay: { enabled: false },
      capabilityOverrides: [],
    });
    await expect(reloaded.providerManagerModule.providerManager.list()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        models: [{ id: "claude-opus-4", enabled: true }],
      }),
    ]);
  });

  it("cooperates with default-model-settings to resolve the selected default model target", async () => {
    const homeDir = createTempHome();
    const firstLoad = await loadProviderRuntime(homeDir);

    const created = await firstLoad.providerManagerModule.providerManager.create(
      createProviderInput({
        apiKey: "sk-role",
        models: [
          { id: "claude-sonnet-4", enabled: true },
          { id: "claude-haiku-4", enabled: true },
        ],
      })
    );

    await firstLoad.defaultModelSettingsModule.saveDefaultModelSettings({
      defaultProviderId: created.id,
      defaultModelId: "claude-haiku-4",
    });

    await expect(firstLoad.defaultModelSettingsModule.resolveDefaultModelTarget()).resolves.toEqual(
      expect.objectContaining({
        apiKey: "sk-role",
        selectedModelId: "claude-haiku-4",
        provider: expect.objectContaining({
          id: created.id,
        }),
      })
    );

    const secondLoad = await loadProviderRuntime(homeDir);
    await expect(
      secondLoad.defaultModelSettingsModule.resolveDefaultModelTarget()
    ).resolves.toEqual(
      expect.objectContaining({
        apiKey: "sk-role",
        selectedModelId: "claude-haiku-4",
        provider: expect.objectContaining({
          id: created.id,
        }),
      })
    );
  });
});
