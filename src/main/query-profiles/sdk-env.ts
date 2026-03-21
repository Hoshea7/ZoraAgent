import { buildProviderSdkEnv, providerManager } from "../provider-manager";
import { loadMemorySettings } from "../memory-settings";

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
  const effectiveModelId = options?.selectedModelId ?? provider.modelId;

  console.log(`[${profileName}] Active provider:`, {
    lockedProviderId: options?.providerId ?? "(default)",
    selectedModelId: options?.selectedModelId ?? "(provider default)",
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
