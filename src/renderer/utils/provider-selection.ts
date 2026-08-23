import type { DefaultModelSettings } from "../../shared/types/default-model";
import type { ProviderConfig } from "../../shared/types/provider";
import {
  getEnabledProviderModels,
  normalizeOptionalModelId,
  resolveProviderModel,
} from "../../shared/provider-model";
import type { Session } from "../types";

export interface ProviderModelOption {
  modelId: string;
  label: string;
}

export { normalizeOptionalModelId } from "../../shared/provider-model";

export function getProviderModels(provider: ProviderConfig): ProviderModelOption[] {
  return getEnabledProviderModels(provider).map((model) => ({
    modelId: model.id,
    label: model.name ?? model.id,
  }));
}

export function getRunnableProviders(
  providers: ProviderConfig[]
): ProviderConfig[] {
  return providers.filter(
    (provider) => provider.enabled && getEnabledProviderModels(provider).length > 0
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

export function isLockedTargetUnavailable(
  providers: ProviderConfig[],
  session: Session | null
): boolean {
  if (!session?.providerLocked || !session.providerId) return false;
  const provider = providers.find((item) => item.id === session.providerId);
  if (!provider?.enabled) return true;
  const selectedModelId = normalizeOptionalModelId(session.selectedModelId);
  if (selectedModelId) {
    return resolveProviderModel(provider, selectedModelId)?.enabled !== true;
  }
  return getEnabledProviderModels(provider).length === 0;
}

export function resolveSelectedModelId(
  provider: ProviderConfig | null,
  requestedModelId?: string
): string | undefined {
  if (!provider) {
    return undefined;
  }
  const requested = normalizeOptionalModelId(requestedModelId);
  if (requested) {
    const model = resolveProviderModel(provider, requested);
    return model?.enabled ? model.id : undefined;
  }
  return getEnabledProviderModels(provider)[0]?.id;
}

export function resolveConfiguredDefaultTarget(
  providers: ProviderConfig[],
  settings?: DefaultModelSettings | null
): {
  provider: ProviderConfig | null;
  modelId?: string;
} {
  if (!settings?.defaultProviderId) {
    return {
      provider: null,
      modelId: undefined,
    };
  }

  const configuredProvider =
    getRunnableProviders(providers).find(
      (provider) => provider.id === settings.defaultProviderId
    ) ?? null;

  return {
    provider: configuredProvider,
    modelId: resolveSelectedModelId(
      configuredProvider,
      settings.defaultModelId ?? undefined
    ),
  };
}

export function resolveSelectedModelOverride(
  provider: ProviderConfig | null,
  requestedModelId?: string
): string {
  const resolvedModelId = resolveSelectedModelId(provider, requestedModelId);
  if (!resolvedModelId) {
    return "";
  }

  return resolvedModelId;
}

export function resolveDraftProviderAndModel(
  providers: ProviderConfig[],
  settings: DefaultModelSettings | null | undefined,
  provider: ProviderConfig | null,
  requestedModelId?: string
): {
  providerId?: string;
  modelId?: string;
} {
  const resolvedModelId = resolveSelectedModelId(provider, requestedModelId);
  const configuredDefault = resolveConfiguredDefaultTarget(providers, settings);

  if (
    !provider ||
    !resolvedModelId ||
    (configuredDefault.provider?.id === provider.id &&
      configuredDefault.modelId === resolvedModelId)
  ) {
    return {};
  }

  const shouldPersistProviderId = configuredDefault.provider?.id !== provider.id;

  return {
    providerId: shouldPersistProviderId ? provider.id : undefined,
    modelId: resolvedModelId,
  };
}

export function resolveCurrentProviderAndModel(
  providers: ProviderConfig[],
  session: Session | null,
  settings?: DefaultModelSettings | null,
  draftSelectedProviderId?: string,
  draftSelectedModelId?: string
): {
  provider: ProviderConfig | null;
  modelId?: string;
  isLocked: boolean;
  isLockedTargetUnavailable: boolean;
} {
  const isLocked = Boolean(session?.providerLocked);
  const lockedTargetUnavailable = isLockedTargetUnavailable(providers, session);

  if (isLocked) {
    const provider = resolveLockedProvider(providers, session);
    const lockedModelId = normalizeOptionalModelId(session?.selectedModelId);
    return {
      provider,
      modelId: resolveSelectedModelId(provider, lockedModelId),
      isLocked,
      isLockedTargetUnavailable: lockedTargetUnavailable,
    };
  }

  const configuredDefault = resolveConfiguredDefaultTarget(providers, settings);
  const draftProvider =
    (draftSelectedProviderId
      ? providers.find(
          (provider) => provider.id === draftSelectedProviderId && provider.enabled
        ) ?? null
      : null) ?? configuredDefault.provider;

  return {
    provider: draftProvider,
    modelId:
      draftSelectedProviderId || draftSelectedModelId
        ? resolveSelectedModelId(draftProvider, draftSelectedModelId)
        : configuredDefault.modelId,
    isLocked,
    isLockedTargetUnavailable: lockedTargetUnavailable,
  };
}
