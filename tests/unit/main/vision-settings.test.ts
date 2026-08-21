import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VisionSettingsStore } from "@/main/vision-settings";
import type { ProviderConfig } from "@/shared/types/provider";

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider-1",
    name: "Provider",
    providerType: "anthropic",
    baseUrl: "https://example.com",
    apiKey: "",
    models: [{ id: "claude-sonnet-4-20250514", enabled: true }],
    protocol: "anthropic-messages",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("VisionSettingsStore", () => {
  it("loads disabled defaults when the file does not exist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-vision-settings-"));
    const store = new VisionSettingsStore(path.join(root, "vision-settings.json"));

    await expect(store.load()).resolves.toEqual({
      relay: { enabled: false },
      capabilityOverrides: [],
    });
  });

  it("persists normalized capability overrides", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-vision-settings-"));
    const settingsPath = path.join(root, "vision-settings.json");
    const store = new VisionSettingsStore(settingsPath);

    await store.save({
      relay: { enabled: false, providerId: "ignored", modelId: "ignored" },
      capabilityOverrides: [
        { providerId: " provider-1 ", modelId: " model-1 ", capability: "supported" },
      ],
    });

    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
      relay: { enabled: false },
      capabilityOverrides: [
        { providerId: "provider-1", modelId: "model-1", capability: "supported" },
      ],
    });
  });

  it("accepts an explicitly supported configured model as the visual route", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-vision-settings-"));
    const store = new VisionSettingsStore(path.join(root, "vision-settings.json"), async () => ({
      provider: provider({ models: [{ id: "private-model", enabled: true }] }),
      apiKey: "sk-test",
    }));

    await expect(
      store.save({
        relay: { enabled: true, providerId: "provider-1", modelId: "private-model" },
        capabilityOverrides: [
          { providerId: "provider-1", modelId: "private-model", capability: "supported" },
        ],
      })
    ).resolves.toEqual({
      relay: { enabled: true, providerId: "provider-1", modelId: "private-model" },
      capabilityOverrides: [
        { providerId: "provider-1", modelId: "private-model", capability: "supported" },
      ],
    });
  });

  it("accepts any configured model selected by the user as the visual route", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-vision-settings-"));
    const store = new VisionSettingsStore(path.join(root, "vision-settings.json"), async () => ({
      provider: provider({ models: [{ id: "private-model", enabled: true }] }),
      apiKey: "sk-test",
    }));

    await expect(store.save({
      relay: { enabled: true, providerId: "provider-1", modelId: "private-model" },
      capabilityOverrides: [],
    })).resolves.toEqual({
      relay: { enabled: true, providerId: "provider-1", modelId: "private-model" },
      capabilityOverrides: [],
    });
  });

  it("resolves a provider model target independently from the agent runtime", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-vision-settings-"));
    const store = new VisionSettingsStore(path.join(root, "vision-settings.json"), async () => ({
      provider: provider(),
      apiKey: "sk-test",
    }));
    await store.save({
      relay: {
        enabled: true,
        providerId: "provider-1",
        modelId: "claude-sonnet-4-20250514",
      },
      capabilityOverrides: [],
    });

    await expect(store.resolveRoute()).resolves.toMatchObject({
      providerId: "provider-1",
      protocol: "anthropic-messages",
      apiKey: "sk-test",
      modelId: "claude-sonnet-4-20250514",
    });
  });

});
