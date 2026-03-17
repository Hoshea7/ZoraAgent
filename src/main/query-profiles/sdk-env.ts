import { buildProviderSdkEnv, providerManager } from "../provider-manager";

export async function resolveSdkEnvForProfile(
  profileName: "awakening" | "productivity"
): Promise<Record<string, string>> {
  let env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CLAUDE_AGENT_SDK_CLIENT_APP: "zora-agent",
  };

  const activeProvider = await providerManager.getDefaultProvider();

  if (!activeProvider) {
    console.log(
      `[${profileName}] No active provider configured. Falling back to process.env provider settings.`
    );
    return env;
  }

  const decryptedApiKey = await providerManager.decryptApiKey(activeProvider.id);

  if (!decryptedApiKey) {
    throw new Error(`Failed to decrypt API Key for the active ${profileName} provider.`);
  }

  console.log(`[${profileName}] Active provider:`, {
    id: activeProvider.id,
    name: activeProvider.name,
    providerType: activeProvider.providerType,
    baseUrl: activeProvider.baseUrl,
    modelId: activeProvider.modelId ?? "(default model)",
    isDefault: activeProvider.isDefault,
    enabled: activeProvider.enabled,
  });

  env = buildProviderSdkEnv({
    apiKey: decryptedApiKey,
    baseUrl: activeProvider.baseUrl,
    modelId: activeProvider.modelId,
    baseEnv: env,
  });
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "zora-agent";

  return env;
}
