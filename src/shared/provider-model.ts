import type { ProviderConfig, ProviderModel } from "./types/provider";

export function normalizeOptionalModelId(
  value?: string | null
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

export function getEnabledProviderModels(
  provider: Pick<ProviderConfig, "models">
): ProviderModel[] {
  return provider.models.filter((model) => model.enabled);
}

export function resolveProviderModel(
  provider: Pick<ProviderConfig, "models">,
  requestedModelId?: string | null
): ProviderModel | null {
  const requested = normalizeOptionalModelId(requestedModelId);
  if (!requested) {
    return null;
  }

  return provider.models.find((model) => model.id === requested) ?? null;
}

export interface FetchedProviderModel {
  id: string;
  name?: string;
}

export function mergeFetchedProviderModels(
  existing: readonly ProviderModel[],
  fetched: readonly FetchedProviderModel[]
): ProviderModel[] {
  const result = existing.map((model) => ({ ...model }));
  const knownIds = new Set(result.map((model) => model.id));

  for (const candidate of fetched) {
    const id = normalizeOptionalModelId(candidate.id);
    if (!id) {
      continue;
    }

    const name = normalizeOptionalModelId(candidate.name);
    const existing = result.find((model) => model.id === id);
    if (existing) {
      if (!existing.name && name) existing.name = name;
      continue;
    }
    result.push({
      id,
      ...(name ? { name } : {}),
      enabled: false,
    });
    knownIds.add(id);
  }

  return result;
}
