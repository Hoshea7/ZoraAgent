import { describe, expect, it } from "vitest";
import {
  migrateProviderConfigFile,
  PROVIDER_CONFIG_VERSION,
} from "../../../src/main/provider-config";

const legacyProvider = {
  id: "provider-a",
  name: "Provider A",
  providerType: "custom",
  baseUrl: "https://example.com",
  apiKey: "encrypted-key",
  modelId: "model-main",
  roleModels: {
    sonnetModel: "model-main",
    opusModel: "model-opus",
    haikuModel: " ",
    smallFastModel: "model-small",
  },
  contextWindow: 64_000,
  presetId: "custom",
  protocol: "anthropic-messages",
  enabled: false,
  isDefault: true,
  createdAt: 1,
  updatedAt: 2,
};

describe("migrateProviderConfigFile", () => {
  it("migrates the legacy array into a versioned multi-model file", () => {
    const result = migrateProviderConfigFile([legacyProvider]);

    expect(result.migrated).toBe(true);
    expect(result.file.version).toBe(PROVIDER_CONFIG_VERSION);
    expect(result.file.providers[0]).toMatchObject({
      id: "provider-a",
      name: "Provider A",
      providerType: "custom",
      baseUrl: "https://example.com",
      apiKey: "encrypted-key",
      presetId: "custom",
      protocol: "anthropic-messages",
      enabled: false,
      createdAt: 1,
      updatedAt: 2,
      models: [
        { id: "model-main", enabled: true, contextWindow: 64_000 },
        { id: "model-opus", enabled: true, contextWindow: 64_000 },
        { id: "model-small", enabled: true, contextWindow: 64_000 },
      ],
    });
    expect(result.file.providers[0]).not.toHaveProperty("modelId");
    expect(result.file.providers[0]).not.toHaveProperty("roleModels");
    expect(result.file.providers[0]).not.toHaveProperty("contextWindow");
  });

  it("keeps the legacy default provider first while removing its old flag", () => {
    const result = migrateProviderConfigFile([
      { ...legacyProvider, id: "provider-b", isDefault: false },
      legacyProvider,
    ]);

    expect(result.file.providers.map((provider) => provider.id)).toEqual([
      "provider-a",
      "provider-b",
    ]);
    expect(result.file.providers[0]).not.toHaveProperty("isDefault");
  });

  it("does not change an already migrated file", () => {
    const first = migrateProviderConfigFile([legacyProvider]);
    const second = migrateProviderConfigFile(first.file);

    expect(second).toEqual({ file: first.file, migrated: false });
  });

  it("rejects malformed data instead of replacing it", () => {
    expect(() => migrateProviderConfigFile({ version: 2, providers: "bad" })).toThrow(
      "Provider config file is malformed"
    );
  });
});
