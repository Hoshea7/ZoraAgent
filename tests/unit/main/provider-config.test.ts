import { describe, expect, it } from "vitest";
import {
  parseProviderConfigFile,
  PROVIDER_CONFIG_VERSION,
} from "../../../src/main/provider-config";

const provider = {
  id: "provider-a",
  name: "Provider A",
  providerType: "custom",
  baseUrl: "https://example.com",
  apiKey: "encrypted-key",
  models: [
    { id: "model-main", enabled: true, contextWindow: 64_000 },
    { id: "model-opus", enabled: false, maxTokens: 8_192 },
  ],
  presetId: "custom",
  protocol: "anthropic-messages",
  enabled: false,
  createdAt: 1,
  updatedAt: 2,
};

describe("parseProviderConfigFile", () => {
  it("parses the current versioned multi-model file", () => {
    const result = parseProviderConfigFile({
      version: PROVIDER_CONFIG_VERSION,
      providers: [provider],
    });

    expect(result.version).toBe(PROVIDER_CONFIG_VERSION);
    expect(result.providers[0]).toMatchObject({
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
      models: provider.models,
    });
  });

  it("rejects legacy arrays instead of carrying a migration path", () => {
    expect(() => parseProviderConfigFile([provider])).toThrow(
      "Provider config file is malformed"
    );
  });

  it("rejects malformed data instead of replacing it", () => {
    expect(() => parseProviderConfigFile({ version: 2, providers: "bad" })).toThrow(
      "Provider config file is malformed"
    );
  });

  it("rejects a missing protocol instead of silently choosing one", () => {
    const { protocol: _protocol, ...withoutProtocol } = provider;
    expect(() =>
      parseProviderConfigFile({
        version: PROVIDER_CONFIG_VERSION,
        providers: [withoutProtocol],
      })
    ).toThrow("provider.protocol");
  });
});
