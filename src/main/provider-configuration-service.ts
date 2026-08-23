import type {
  ProviderConfig,
  ProviderUpdateInput,
} from "../shared/types/provider";
import { providerManager } from "./provider-manager";
import { reconcileDeletedProviderReference } from "./provider-reference-lifecycle";

export async function updateProviderConfiguration(
  providerId: string,
  updates: ProviderUpdateInput
): Promise<ProviderConfig> {
  const existing = updates.models
    ? await providerManager.getProviderByIdWithKey(providerId)
    : null;
  const next = await providerManager.update(providerId, updates);

  if (existing && updates.models) {
    const nextEnabledModelIds = new Set(
      next.models.filter((model) => model.enabled).map((model) => model.id)
    );
    const unavailableModelIds = existing.provider.models
      .map((model) => model.id)
      .filter((modelId) => !nextEnabledModelIds.has(modelId));
    if (unavailableModelIds.length > 0) {
      await reconcileDeletedProviderReference({
        providerId,
        modelIds: unavailableModelIds,
      });
    }
  }

  return next;
}

export async function deleteProviderConfiguration(providerId: string): Promise<void> {
  await providerManager.delete(providerId);
  await reconcileDeletedProviderReference({ providerId });
}
