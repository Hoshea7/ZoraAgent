import type { ProviderConfig } from "../../shared/types/provider";
import type { Session } from "../types";

export interface ProviderModelOption {
  modelId: string;
  label: string;
}

export function normalizeOptionalModelId(
  value?: string | null
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getProviderModels(provider: ProviderConfig): ProviderModelOption[] {
  const modelMap = new Map<string, string[]>();
  const normalizedModelId = normalizeOptionalModelId(provider.modelId);

  if (normalizedModelId) {
    modelMap.set(normalizedModelId, ["主模型"]);
  }

  const roleEntries = [
    { key: "sonnetModel", label: "Sonnet" },
    { key: "opusModel", label: "Opus" },
    { key: "haikuModel", label: "Haiku" },
    { key: "smallFastModel", label: "Small" },
  ] as const;

  for (const { key, label } of roleEntries) {
    const modelId = normalizeOptionalModelId(provider.roleModels?.[key]);
    if (!modelId) {
      continue;
    }

    const existing = modelMap.get(modelId);
    if (existing) {
      existing.push(label);
    } else {
      modelMap.set(modelId, [label]);
    }
  }

  return Array.from(modelMap.entries()).map(([modelId, labels]) => ({
    modelId,
    label: labels.join(" / "),
  }));
}

export function resolveActiveProvider(
  providers: ProviderConfig[]
): ProviderConfig | null {
  return (
    providers.find((provider) => provider.isDefault) ??
    providers.find((provider) => provider.enabled) ??
    null
  );
}

export function resolveLockedProvider(
  providers: ProviderConfig[],
  session: Session | null
): ProviderConfig | null {
  if (!session?.providerLocked || !session.providerId) {
    return null;
  }

  return providers.find((provider) => provider.id === session.providerId) ?? null;
}

export function isLockedProviderMissing(
  providers: ProviderConfig[],
  session: Session | null
): boolean {
  return Boolean(
    session?.providerLocked &&
      session.providerId &&
      !providers.some((provider) => provider.id === session.providerId)
  );
}

export function resolveSelectedModelId(
  provider: ProviderConfig | null,
  requestedModelId?: string
): string | undefined {
  if (!provider) {
    return undefined;
  }

  const normalizedRequestedModelId = normalizeOptionalModelId(requestedModelId);
  const models = getProviderModels(provider);

  if (
    normalizedRequestedModelId &&
    models.some((model) => model.modelId === normalizedRequestedModelId)
  ) {
    return normalizedRequestedModelId;
  }

  return normalizeOptionalModelId(provider.modelId) ?? models[0]?.modelId;
}

export function resolveSelectedModelOverride(
  provider: ProviderConfig | null,
  requestedModelId?: string
): string {
  const resolvedModelId = resolveSelectedModelId(provider, requestedModelId);
  const providerModelId = normalizeOptionalModelId(provider?.modelId);

  if (!resolvedModelId || resolvedModelId === providerModelId) {
    return "";
  }

  return resolvedModelId;
}

export function resolveCurrentProviderAndModel(
  providers: ProviderConfig[],
  session: Session | null,
  draftSelectedModelId?: string
): {
  provider: ProviderConfig | null;
  modelId?: string;
  isLocked: boolean;
  isMissingLockedProvider: boolean;
} {
  const isLocked = Boolean(session?.providerLocked);
  const isMissingLockedProvider = isLockedProviderMissing(providers, session);
  const provider = isLocked
    ? resolveLockedProvider(providers, session)
    : resolveActiveProvider(providers);
  const requestedModelId = session?.selectedModelId ?? draftSelectedModelId;

  return {
    provider,
    modelId: resolveSelectedModelId(provider, requestedModelId),
    isLocked,
    isMissingLockedProvider,
  };
}
