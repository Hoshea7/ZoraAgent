import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProviderConfig } from "@/shared/types/provider";
import { DEFAULT_DEFAULT_MODEL_SETTINGS } from "@/shared/types/default-model";

const providerManagerModuleId = path.resolve(
  process.cwd(),
  "src/main/provider-manager.ts"
);
const tempHomes = new Set<string>();

function createTempHome() {
  const homeDir = mkdtempSync(path.join(tmpdir(), "zora-default-model-"));
  tempHomes.add(homeDir);
  return homeDir;
}

function createProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider-1",
    name: "Anthropic",
    providerType: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "masked",
    models: [{ id: "claude-sonnet", enabled: true }],
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function loadDefaultModelSettingsModule(homeDir: string) {
  vi.resetModules();

  const getProviderByIdWithKey = vi.fn();
  const getDefaultProviderWithKey = vi.fn();

  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
      ...actual,
      homedir: () => homeDir,
    };
  });

  vi.doMock(providerManagerModuleId, () => ({
    providerManager: {
      getProviderByIdWithKey,
      getDefaultProviderWithKey,
    },
  }));

  const module = await import("@/main/default-model-settings");

  return {
    ...module,
    providerManagerMock: {
      getProviderByIdWithKey,
      getDefaultProviderWithKey,
    },
  };
}

afterEach(() => {
  vi.doUnmock("node:os");
  vi.doUnmock(providerManagerModuleId);
  vi.resetModules();

  for (const homeDir of tempHomes) {
    rmSync(homeDir, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("main default-model-settings", () => {
  it("provides the in-memory electron-store mock for main-process tests", async () => {
    const { default: Store } = await import("electron-store");

    const first = new Store<{ theme: string }>({ name: "unit-default-model" });
    const second = new Store<{ theme: string }>({ name: "unit-default-model" });

    first.set("theme", "light");

    expect(second.get("theme")).toBe("light");
  });

  it("returns the default settings when no file exists", async () => {
    const { loadDefaultModelSettings } = await loadDefaultModelSettingsModule(createTempHome());

    await expect(loadDefaultModelSettings()).resolves.toEqual(
      DEFAULT_DEFAULT_MODEL_SETTINGS
    );
  });

  it("saves normalized settings and loads them back", async () => {
    const homeDir = createTempHome();
    const { loadDefaultModelSettings, saveDefaultModelSettings } =
      await loadDefaultModelSettingsModule(homeDir);

    await saveDefaultModelSettings({
      defaultProviderId: " provider-1 ",
      defaultModelId: " model-1 ",
    });

    await expect(loadDefaultModelSettings()).resolves.toEqual({
      defaultProviderId: "provider-1",
      defaultModelId: "model-1",
    });
    expect(
      JSON.parse(
        readFileSync(path.join(homeDir, ".zora", "default-model-settings.json"), "utf8")
      )
    ).toEqual({
      defaultProviderId: "provider-1",
      defaultModelId: "model-1",
    });
  });

  it("resolves the configured provider and preserves a matching selected model", async () => {
    const { providerManagerMock, resolveDefaultModelTarget, saveDefaultModelSettings } =
      await loadDefaultModelSettingsModule(createTempHome());

    await saveDefaultModelSettings({
      defaultProviderId: "provider-1",
      defaultModelId: "claude-haiku",
    });

    providerManagerMock.getProviderByIdWithKey.mockResolvedValue({
      provider: createProvider({
        models: [
          { id: "claude-sonnet", enabled: true },
          { id: "claude-haiku", enabled: true },
        ],
      }),
      apiKey: "secret-key",
    });

    await expect(resolveDefaultModelTarget()).resolves.toEqual({
      provider: createProvider({
        models: [
          { id: "claude-sonnet", enabled: true },
          { id: "claude-haiku", enabled: true },
        ],
      }),
      apiKey: "secret-key",
      selectedModelId: "claude-haiku",
    });
    expect(providerManagerMock.getDefaultProviderWithKey).not.toHaveBeenCalled();
  });

  it("returns null when the configured model is missing", async () => {
    const { providerManagerMock, resolveDefaultModelTarget, saveDefaultModelSettings } =
      await loadDefaultModelSettingsModule(createTempHome());

    await saveDefaultModelSettings({
      defaultProviderId: "provider-1",
      defaultModelId: "missing-model",
    });

    providerManagerMock.getProviderByIdWithKey.mockResolvedValue({
      provider: createProvider(),
      apiKey: "secret-key",
    });

    await expect(resolveDefaultModelTarget()).resolves.toBeNull();
    expect(providerManagerMock.getDefaultProviderWithKey).not.toHaveBeenCalled();
  });

  it("does not switch providers when the configured provider is disabled", async () => {
    const { providerManagerMock, resolveDefaultModelTarget, saveDefaultModelSettings } =
      await loadDefaultModelSettingsModule(createTempHome());

    await saveDefaultModelSettings({
      defaultProviderId: "provider-1",
      defaultModelId: "claude-sonnet",
    });

    providerManagerMock.getProviderByIdWithKey.mockResolvedValue({
      provider: createProvider({ enabled: false }),
      apiKey: "secret-key",
    });
    providerManagerMock.getDefaultProviderWithKey.mockResolvedValue({
      provider: createProvider({
        id: "provider-2",
      }),
      apiKey: "fallback-key",
    });

    await expect(resolveDefaultModelTarget()).resolves.toBeNull();
    expect(providerManagerMock.getDefaultProviderWithKey).not.toHaveBeenCalled();
  });

  it("returns null when the fallback provider is disabled", async () => {
    const { providerManagerMock, resolveDefaultModelTarget } =
      await loadDefaultModelSettingsModule(createTempHome());

    providerManagerMock.getDefaultProviderWithKey.mockResolvedValue({
      provider: createProvider({
        enabled: false,
      }),
      apiKey: "fallback-key",
    });

    await expect(resolveDefaultModelTarget()).resolves.toBeNull();
  });

  it("materializes the first usable target as explicit default settings", async () => {
    const homeDir = createTempHome();
    const { providerManagerMock, resolveDefaultModelTarget } =
      await loadDefaultModelSettingsModule(homeDir);
    providerManagerMock.getDefaultProviderWithKey.mockResolvedValue({
      provider: createProvider(),
      apiKey: "fallback-key",
    });

    await expect(resolveDefaultModelTarget()).resolves.toEqual(
      expect.objectContaining({ selectedModelId: "claude-sonnet" })
    );
    expect(
      JSON.parse(
        readFileSync(path.join(homeDir, ".zora", "default-model-settings.json"), "utf8")
      )
    ).toEqual({
      defaultProviderId: "provider-1",
      defaultModelId: "claude-sonnet",
    });
  });

  it("returns null when neither a configured nor fallback provider is available", async () => {
    const homeDir = createTempHome();
    const settingsPath = path.join(homeDir, ".zora", "default-model-settings.json");
    const { providerManagerMock, resolveDefaultModelTarget } =
      await loadDefaultModelSettingsModule(homeDir);

    providerManagerMock.getDefaultProviderWithKey.mockResolvedValue(null);

    await expect(resolveDefaultModelTarget()).resolves.toBeNull();
    expect(existsSync(settingsPath)).toBe(false);
  });
});
