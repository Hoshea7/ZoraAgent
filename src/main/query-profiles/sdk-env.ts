import type { ProviderConfig } from "../../shared/types/provider";
import { buildProviderSdkEnv, providerManager } from "../provider-manager";
import { loadMemorySettings } from "../memory-settings";

function normalizeOptionalModelId(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasConfiguredModel(provider: ProviderConfig, modelId?: string | null): boolean {
  const normalizedModelId = normalizeOptionalModelId(modelId);
  if (!normalizedModelId) {
    return false;
  }

  if (normalizeOptionalModelId(provider.modelId) === normalizedModelId) {
    return true;
  }

  return Object.values(provider.roleModels ?? {}).some(
    (value) => normalizeOptionalModelId(value) === normalizedModelId
  );
}

function resolveMemoryRequestedModelId(
  provider: ProviderConfig,
  modelId?: string | null
): string | undefined {
  const normalizedModelId = normalizeOptionalModelId(modelId);
  const providerDefaultModelId = normalizeOptionalModelId(provider.modelId);

  if (
    normalizedModelId &&
    providerDefaultModelId &&
    normalizedModelId === providerDefaultModelId
  ) {
    return undefined;
  }

  return normalizedModelId;
}

export async function resolveSdkEnvForProfile(
  profileName: "awakening" | "productivity" | "memory",
  options?: {
    providerId?: string;
    selectedModelId?: string;
  }
): Promise<Record<string, string>> {
  let env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CLAUDE_AGENT_SDK_CLIENT_APP: "zora",
  };

  let result: Awaited<ReturnType<typeof providerManager.getProviderByIdWithKey>> | null = null;
  let memorySelectedModelId: string | undefined;

  if (options?.providerId) {
    result = await providerManager.getProviderByIdWithKey(options.providerId);
    if (!result) {
      console.warn(
        `[${profileName}] Locked provider ${options.providerId} not found. Falling back.`
      );
    }
  }

  if (!result && profileName === "memory") {
    try {
      const settings = await loadMemorySettings();
      if (settings.memoryProviderId) {
        result = await providerManager.getProviderByIdWithKey(
          settings.memoryProviderId
        );
        if (result && !result.provider.enabled) {
          console.warn(
            `[memory] Configured provider ${settings.memoryProviderId} is disabled, falling back to default`
          );
          result = null;
        }
        if (result) {
          memorySelectedModelId = resolveMemoryRequestedModelId(
            result.provider,
            settings.memoryModelId
          );
          console.log(
            `[memory] Using dedicated memory provider: ${result.provider.name}`
          );
        }
      }
    } catch (err) {
      console.warn(
        "[memory] Failed to load memory settings, using default provider",
        err
      );
    }
  }

  if (!result) {
    result = await providerManager.getDefaultProviderWithKey();
  }

  if (!result) {
    console.log(
      `[${profileName}] No active provider configured. Falling back to process.env provider settings.`
    );
    return env;
  }

  const { provider, apiKey } = result;
  const requestedModelId = normalizeOptionalModelId(
    options?.selectedModelId ?? memorySelectedModelId
  );
  const effectiveModelId =
    requestedModelId && hasConfiguredModel(provider, requestedModelId)
      ? requestedModelId
      : provider.modelId;

  if (requestedModelId && effectiveModelId !== requestedModelId) {
    console.warn(
      `[${profileName}] Requested model ${requestedModelId} is not configured on provider ${provider.name}; falling back to provider default.`
    );
  }

  console.log(`[${profileName}] Active provider:`, {
    lockedProviderId: options?.providerId ?? "(default)",
    selectedModelId: requestedModelId ?? "(provider default)",
    providerId: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    modelId: effectiveModelId ?? "(default model)",
  });

  env = buildProviderSdkEnv({
    apiKey,
    baseUrl: provider.baseUrl,
    modelId: effectiveModelId,
    roleModels: provider.roleModels,
    baseEnv: env,
  });
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "zora";

  return env;
}
