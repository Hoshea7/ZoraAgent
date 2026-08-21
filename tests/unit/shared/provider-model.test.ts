import {
  getEnabledProviderModels,
  mergeFetchedProviderModels,
  resolveProviderModel,
} from "@/shared/provider-model";
import type { ProviderConfig, ProviderModel } from "@/shared/types/provider";

function createProvider(models: ProviderModel[]): ProviderConfig {
  return {
    id: "provider-1",
    name: "Provider",
    providerType: "custom",
    baseUrl: "https://example.com",
    apiKey: "masked",
    protocol: "openai-completions",
    models,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("provider models", () => {
  it("returns only models enabled for new selections", () => {
    const provider = createProvider([
      { id: "model-a", name: "Model A", enabled: true },
      { id: "model-b", name: "Model B", enabled: false },
    ]);

    expect(getEnabledProviderModels(provider)).toEqual([
      { id: "model-a", name: "Model A", enabled: true },
    ]);
  });

  it("resolves an exact configured model without falling back", () => {
    const provider = createProvider([
      { id: "model-a", enabled: true },
      { id: "model-b", enabled: false },
    ]);

    expect(resolveProviderModel(provider, "model-b")).toEqual({
      id: "model-b",
      enabled: false,
    });
    expect(resolveProviderModel(provider, "missing-model")).toBeNull();
  });

  it("adds fetched models disabled and preserves every existing model", () => {
    const existing: ProviderModel[] = [
      { id: "model-a", name: "Custom name", enabled: true },
      { id: "old-model", enabled: false },
      { id: "model-c", enabled: false },
    ];

    expect(
      mergeFetchedProviderModels(existing, [
        { id: "model-a", name: "Catalog name" },
        { id: "model-b", name: "Model B" },
        { id: "model-c", name: "Model C" },
      ])
    ).toEqual([
      { id: "model-a", name: "Custom name", enabled: true },
      { id: "old-model", enabled: false },
      { id: "model-c", name: "Model C", enabled: false },
      { id: "model-b", name: "Model B", enabled: false },
    ]);
  });

  it("normalizes IDs, rejects empty entries, and deduplicates fetched results", () => {
    expect(
      mergeFetchedProviderModels([], [
        { id: " model-a ", name: " Model A " },
        { id: "model-a", name: "Duplicate" },
        { id: "   ", name: "Empty" },
      ])
    ).toEqual([{ id: "model-a", name: "Model A", enabled: false }]);
  });
});
