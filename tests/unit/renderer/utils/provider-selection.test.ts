import {
  resolveConfiguredDefaultTarget,
  resolveCurrentProviderAndModel,
} from "@/renderer/utils/provider-selection";
import type { ProviderConfig } from "@/shared/types/provider";

function provider(
  id: string,
  models: ProviderConfig["models"]
): ProviderConfig {
  return {
    id,
    name: id,
    providerType: "custom",
    baseUrl: "https://example.com/v1",
    apiKey: "masked",
    protocol: "openai-completions",
    models,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("provider selection", () => {
  it("does not infer a default model before settings are loaded", () => {
    const configured = provider("configured", [
      { id: "model-1", enabled: true },
    ]);

    expect(resolveConfiguredDefaultTarget([configured], undefined)).toEqual({
      provider: null,
      modelId: undefined,
    });
  });

  it("marks a locked session unavailable after its exact model is disabled", () => {
    const configured = provider("configured", [
      { id: "locked-model", enabled: false },
    ]);
    const session = {
      providerLocked: true,
      providerId: configured.id,
      selectedModelId: "locked-model",
    } as Parameters<typeof resolveCurrentProviderAndModel>[1];

    expect(resolveCurrentProviderAndModel([configured], session)).toMatchObject({
      provider: configured,
      modelId: undefined,
      isLocked: true,
      isLockedTargetUnavailable: true,
    });
  });

  it("does not resolve an empty configured default Provider", () => {
    const empty = provider("empty", []);
    const configured = provider("configured", [
      { id: "model-1", enabled: true },
    ]);

    expect(
      resolveConfiguredDefaultTarget([empty, configured], {
        defaultProviderId: empty.id,
        defaultModelId: "missing-model",
      })
    ).toEqual({ provider: null, modelId: undefined });
  });
});
