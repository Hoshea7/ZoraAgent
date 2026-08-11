import {
  ModelCapabilityResolver,
  type ModelCatalogEntry,
} from "../shared/model-capability";
import type { ModelCapabilityOverride } from "../shared/types/vision";

let catalogPromise: Promise<ModelCatalogEntry[]> | null = null;

export function loadPiModelCatalog(): Promise<ModelCatalogEntry[]> {
  catalogPromise ??= import("@earendil-works/pi-ai/compat").then(
    ({ getModels, getProviders }) =>
      getProviders().flatMap((providerId) =>
        getModels(providerId).map((model) => ({
          providerId: model.provider,
          modelId: model.id,
          input: model.input,
        }))
      )
  );
  return catalogPromise;
}

export async function createRuntimeModelCapabilityResolver(
  overrides: readonly ModelCapabilityOverride[] = []
): Promise<ModelCapabilityResolver> {
  return new ModelCapabilityResolver({
    overrides,
    catalog: await loadPiModelCatalog(),
  });
}
