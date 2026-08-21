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
