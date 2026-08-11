import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProviderConfig, ProviderCreateInput } from "@/shared/types/provider";

const secretStorageModuleId = path.resolve(
  process.cwd(),
  "src/main/utils/secret-storage.ts"
);
const tempHomes = new Set<string>();

type SecretStorageMock = {
  storeSecret: ReturnType<typeof vi.fn>;
  readSecret: ReturnType<typeof vi.fn>;
};

function createTempHome() {
  const homeDir = mkdtempSync(path.join(tmpdir(), "zora-provider-"));
  tempHomes.add(homeDir);
  return homeDir;
}

function createProviderInput(overrides: Partial<ProviderCreateInput> = {}): ProviderCreateInput {
  return {
    name: "Anthropic Primary",
    providerType: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-test-1",
    modelId: "claude-sonnet-4",
    ...overrides,
  };
}

function readPersistedProviders(homeDir: string): ProviderConfig[] {
  const filePath = path.join(homeDir, ".zora", "providers.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as ProviderConfig[];
}

async function loadProviderManagerModule(
  homeDir: string,
  secretStorageMock?: SecretStorageMock
) {
  vi.resetModules();

  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
      ...actual,
      homedir: () => homeDir,
    };
  });

  if (secretStorageMock) {
    vi.doMock(secretStorageModuleId, () => secretStorageMock);
  } else {
    vi.doUnmock(secretStorageModuleId);
  }

  return import("@/main/provider-manager");
}

afterEach(() => {
  vi.doUnmock("node:os");
  vi.doUnmock(secretStorageModuleId);
  vi.resetModules();

  for (const homeDir of tempHomes) {
    rmSync(homeDir, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("buildProviderSdkEnv", () => {
  it("maps the main model and role models into Anthropic env vars", async () => {
    const { buildProviderSdkEnv } = await loadProviderManagerModule(createTempHome());

    expect(
      buildProviderSdkEnv({
        apiKey: "sk-test",
        baseUrl: "https://api.anthropic.com",
        modelId: "claude-sonnet-4",
        roleModels: {
          sonnetModel: "claude-sonnet-custom",
          smallFastModel: "claude-haiku-custom",
        },
      })
    ).toEqual(
      expect.objectContaining({
        ANTHROPIC_API_KEY: "sk-test",
        ANTHROPIC_MODEL: "claude-sonnet-4",
        ANTHROPIC_SMALL_FAST_MODEL: "claude-haiku-custom",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-custom",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-sonnet-4",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-sonnet-4",
      })
    );
  });

  it("sets third-party base URL flags for non-official endpoints", async () => {
    const { buildProviderSdkEnv } = await loadProviderManagerModule(createTempHome());

    expect(
      buildProviderSdkEnv({
        apiKey: "sk-test",
        baseUrl: "https://openrouter.ai/api/v1",
      })
    ).toEqual(
      expect.objectContaining({
        ANTHROPIC_API_KEY: "sk-test",
        ANTHROPIC_BASE_URL: "https://openrouter.ai/api/v1",
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
      })
    );
  });
});

describe("main provider-manager", () => {
  it("starts empty and creates a masked provider while persisting encrypted api key data", async () => {
    const homeDir = createTempHome();
    const secretStorageMock: SecretStorageMock = {
      storeSecret: vi.fn((value: string) => `enc:${value}`),
      readSecret: vi.fn((value: string) => value.replace(/^enc:/, "")),
    };
    const { providerManager } = await loadProviderManagerModule(homeDir, secretStorageMock);

    await expect(providerManager.list()).resolves.toEqual([]);

    const created = await providerManager.create(
      createProviderInput({
        contextWindow: 36_000,
        roleModels: {
          sonnetModel: "claude-sonnet-4-20250514",
          opusModel: "claude-opus-4-20250514",
        },
      })
    );

    expect(created).toEqual(
      expect.objectContaining({
        name: "Anthropic Primary",
        providerType: "anthropic",
        protocol: "anthropic-messages",
        baseUrl: "https://api.anthropic.com",
        apiKey: "••••••",
        modelId: "claude-sonnet-4",
        enabled: true,
        isDefault: true,
        contextWindow: 36_000,
        roleModels: {
          sonnetModel: "claude-sonnet-4-20250514",
          opusModel: "claude-opus-4-20250514",
        },
      })
    );

    const persisted = readPersistedProviders(homeDir);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.apiKey).toBe("enc:sk-test-1");
    expect(persisted[0]?.protocol).toBe("anthropic-messages");
    expect(persisted[0]?.presetId).toBe("anthropic");
    expect(persisted[0]?.contextWindow).toBe(36_000);
    expect(secretStorageMock.storeSecret).toHaveBeenCalledWith("sk-test-1");

    await expect(providerManager.getProviderByIdWithKey(created.id)).resolves.toEqual({
      provider: persisted[0],
      apiKey: "sk-test-1",
    });
    expect(secretStorageMock.readSecret).toHaveBeenCalledWith("enc:sk-test-1");
  });

  it("persists the selected product preset and protocol", async () => {
    const homeDir = createTempHome();
    const { providerManager } = await loadProviderManagerModule(homeDir);

    const provider = await providerManager.create(
      createProviderInput({
        name: "Agent Plan OpenAI",
        providerType: "volcengine",
        presetId: "volcengine-agent-plan-openai",
        protocol: "openai-completions",
        baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
      })
    );

    expect(provider).toMatchObject({
      presetId: "volcengine-agent-plan-openai",
      providerType: "volcengine",
      protocol: "openai-completions",
      baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    });
  });

  it("materializes legacy providers without protocol as Anthropic-compatible", async () => {
    const homeDir = createTempHome();
    const zoraDir = path.join(homeDir, ".zora");
    mkdirSync(zoraDir, { recursive: true });
    writeFileSync(
      path.join(zoraDir, "providers.json"),
      JSON.stringify([
        {
          id: "legacy-provider",
          name: "Legacy custom",
          providerType: "custom",
          baseUrl: "https://legacy.example.com",
          apiKey: "stored-key",
          modelId: "legacy-model",
          enabled: true,
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ])
    );
    const { providerManager } = await loadProviderManagerModule(homeDir);

    await expect(providerManager.list()).resolves.toEqual([
      expect.objectContaining({
        id: "legacy-provider",
        protocol: "anthropic-messages",
        presetId: "custom",
      }),
    ]);
  });

  it("rejects a protocol that conflicts with a product preset", async () => {
    const { providerManager } = await loadProviderManagerModule(createTempHome());

    await expect(
      providerManager.create(
        createProviderInput({
          providerType: "volcengine",
          presetId: "volcengine-agent-plan-anthropic",
          protocol: "openai-completions",
          baseUrl: "https://ark.cn-beijing.volces.com/api/plan",
        })
      )
    ).rejects.toThrow("Provider protocol does not match the selected preset.");
  });

  it("lists multiple providers, keeps duplicate names, and preserves only one default", async () => {
    const homeDir = createTempHome();
    const { providerManager } = await loadProviderManagerModule(homeDir);

    const first = await providerManager.create(createProviderInput());
    const second = await providerManager.create(
      createProviderInput({
        name: "Anthropic Primary",
        providerType: "custom",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "sk-test-2",
      })
    );

    const providers = await providerManager.list();

    expect(providers).toHaveLength(2);
    expect(providers.map((provider) => provider.name)).toEqual([
      "Anthropic Primary",
      "Anthropic Primary",
    ]);
    expect(new Set(providers.map((provider) => provider.id)).size).toBe(2);
    expect(providers.find((provider) => provider.id === first.id)?.isDefault).toBe(true);
    expect(providers.find((provider) => provider.id === second.id)?.isDefault).toBe(false);
  });

  it("updates provider fields, enabled state, and role models", async () => {
    const { providerManager } = await loadProviderManagerModule(createTempHome());

    const created = await providerManager.create(createProviderInput());
    const updated = await providerManager.update(created.id, {
      name: "Anthropic Backup",
      modelId: "claude-opus-4",
      enabled: false,
      roleModels: {
        haikuModel: "claude-haiku-4",
        smallFastModel: "claude-haiku-fast",
      },
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        name: "Anthropic Backup",
        modelId: "claude-opus-4",
        enabled: false,
        roleModels: {
          haikuModel: "claude-haiku-4",
          smallFastModel: "claude-haiku-fast",
        },
      })
    );

    const persisted = await providerManager.getProviderByIdWithKey(created.id);
    expect(persisted?.provider.enabled).toBe(false);
    expect(persisted?.provider.roleModels).toEqual({
      haikuModel: "claude-haiku-4",
      smallFastModel: "claude-haiku-fast",
    });
  });

  it("switches the default provider and clears the previous default flag", async () => {
    const { providerManager } = await loadProviderManagerModule(createTempHome());

    const first = await providerManager.create(createProviderInput());
    const second = await providerManager.create(
      createProviderInput({
        name: "Secondary",
        apiKey: "sk-test-2",
      })
    );

    await providerManager.setDefault(second.id);

    const providers = await providerManager.list();
    expect(providers.find((provider) => provider.id === first.id)?.isDefault).toBe(false);
    expect(providers.find((provider) => provider.id === second.id)?.isDefault).toBe(true);
  });

  it("deletes providers and throws when deleting a missing provider", async () => {
    const { providerManager } = await loadProviderManagerModule(createTempHome());

    const created = await providerManager.create(createProviderInput());

    await providerManager.delete(created.id);
    await expect(providerManager.list()).resolves.toEqual([]);
    await expect(providerManager.delete(created.id)).rejects.toThrow("Provider not found.");
  });

  it("persists providers across module reloads and restores decrypted api keys", async () => {
    const homeDir = createTempHome();
    const secretStorageMock: SecretStorageMock = {
      storeSecret: vi.fn((value: string) => `wrapped:${value}`),
      readSecret: vi.fn((value: string) => value.replace(/^wrapped:/, "")),
    };

    const firstLoad = await loadProviderManagerModule(homeDir, secretStorageMock);
    const created = await firstLoad.providerManager.create(
      createProviderInput({
        apiKey: "sk-persisted",
      })
    );

    const secondLoad = await loadProviderManagerModule(homeDir, secretStorageMock);
    await expect(secondLoad.providerManager.list()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        apiKey: "••••••",
      }),
    ]);
    await expect(secondLoad.providerManager.decryptApiKey(created.id)).resolves.toBe(
      "sk-persisted"
    );
  });

  it("rejects invalid inputs and reports missing records", async () => {
    const { providerManager } = await loadProviderManagerModule(createTempHome());

    await expect(
      providerManager.create(createProviderInput({ name: "   " }))
    ).rejects.toThrow("Provider name is required.");
    await expect(
      providerManager.create(createProviderInput({ apiKey: "   " }))
    ).rejects.toThrow("API Key is required.");
    await expect(
      providerManager.create({
        ...createProviderInput(),
        providerType: "invalid" as ProviderCreateInput["providerType"],
      })
    ).rejects.toThrow("A valid providerType is required.");

    await expect(providerManager.update("missing-id", { name: "Nope" })).rejects.toThrow(
      "Provider not found."
    );
    await expect(providerManager.setDefault("missing-id")).rejects.toThrow(
      "Provider not found."
    );
    await expect(providerManager.getProviderByIdWithKey("missing-id")).resolves.toBeNull();
    await expect(providerManager.decryptApiKey("missing-id")).resolves.toBeNull();
    await expect(providerManager.hasConfigured()).resolves.toBe(false);
    expect(existsSync(path.join(createTempHome(), ".zora", "providers.json"))).toBe(false);
  });
});
