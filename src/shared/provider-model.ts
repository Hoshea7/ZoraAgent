import type { ProviderConfig } from "./types/provider";

export function normalizeOptionalModelId(
  value?: string | null
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

export function resolveProviderModelId(
  provider: ProviderConfig,
  requestedModelId?: string | null
): string | undefined {
  const configuredModelIds = [
    provider.modelId,
    ...Object.values(provider.roleModels ?? {}),
  ].flatMap((modelId) => {
    const normalized = normalizeOptionalModelId(modelId);
    return normalized ? [normalized] : [];
  });
  const requested = normalizeOptionalModelId(requestedModelId);

  if (requested && configuredModelIds.includes(requested)) {
    return requested;
  }

  return configuredModelIds[0];
}
