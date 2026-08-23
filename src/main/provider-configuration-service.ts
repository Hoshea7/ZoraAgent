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
    const nextModelIds = new Set(next.models.map((model) => model.id));
    const removedModelIds = existing.provider.models
      .map((model) => model.id)
      .filter((modelId) => !nextModelIds.has(modelId));
    if (removedModelIds.length > 0) {
      await reconcileDeletedProviderReference({ providerId, modelIds: removedModelIds });
    }
  }

  return next;
}

export async function deleteProviderConfiguration(providerId: string): Promise<void> {
  await providerManager.delete(providerId);
  await reconcileDeletedProviderReference({ providerId });
}
