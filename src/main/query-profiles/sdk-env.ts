import type { ProviderConfig } from "../../shared/types/provider";
import {
  getEnabledProviderModels,
  normalizeOptionalModelId,
  resolveProviderModel,
} from "../../shared/provider-model";
import { buildProviderSdkEnv, providerManager } from "../provider-manager";
import { loadMemorySettings } from "../memory-settings";
import {
  loadDefaultModelSettings,
  resolveDefaultModelTarget,
} from "../default-model-settings";
import { logAgentEvent } from "../agent-loop-log";
import type { AgentRuntimeTarget } from "../runtime/runtime-execution-target";

export async function resolveSdkEnvForProfile(
  profileName: "productivity" | "memory",
  options?: {
    executionTarget?: AgentRuntimeTarget;
  }
): Promise<Record<string, string>> {
  let env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CLAUDE_AGENT_SDK_CLIENT_APP: "zora",
  };

  let result: Awaited<ReturnType<typeof providerManager.getProviderByIdWithKey>> | null = null;
  let memorySelectedModelId: string | undefined;
  let defaultSelectedModelId: string | undefined;

  if (options?.executionTarget) {
    const { provider, modelId } = options.executionTarget;
    logAgentEvent("pre", "model", "模型已确认", {
      profile: profileName,
      provider: provider.name,
      providerType: provider.providerType,
      model: modelId,
      selectedModel: modelId,
    });
    return buildProviderSdkEnv({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      modelId,
      baseEnv: env,
    });
  }

  if (!result && profileName === "memory") {
    try {
      const settings = await loadMemorySettings();
      if (settings.memoryProviderId) {
        result = await providerManager.getProviderByIdWithKey(
          settings.memoryProviderId
        );
        if (!result) {
          throw new Error(`MEMORY_PROVIDER_NOT_FOUND:${settings.memoryProviderId}`);
        }
        if (result && !result.provider.enabled) {
          throw new Error("MEMORY_PROVIDER_DISABLED");
        }
        if (result) {
          memorySelectedModelId = normalizeOptionalModelId(settings.memoryModelId);
          logAgentEvent("pre", "model", "模型已确认", {
            profile: profileName,
            provider: result.provider.name,
          });
        }
      }
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  if (!result && profileName !== "memory") {
    const defaultSettings = await loadDefaultModelSettings();
    const defaultTarget = await resolveDefaultModelTarget();
    if (defaultTarget) {
      result = {
        provider: defaultTarget.provider,
        apiKey: defaultTarget.apiKey,
      };
      defaultSelectedModelId = defaultTarget.selectedModelId;
    } else if (defaultSettings.defaultProviderId) {
      throw new Error(
        `MODEL_NOT_CONFIGURED:${defaultSettings.defaultModelId ?? ""}`
      );
    }
  }

  if (!result && profileName === "memory") {
    const defaultSettings = await loadDefaultModelSettings();
    const defaultTarget = await resolveDefaultModelTarget();
    if (defaultTarget) {
      result = { provider: defaultTarget.provider, apiKey: defaultTarget.apiKey };
      defaultSelectedModelId = defaultTarget.selectedModelId;
    } else if (defaultSettings.defaultProviderId) {
      throw new Error(
        `MODEL_NOT_CONFIGURED:${defaultSettings.defaultModelId ?? ""}`
      );
    }
  }

  if (!result && profileName === "memory") {
    throw new Error("MEMORY_MODEL_NOT_CONFIGURED");
  }

  if (!result) {
    logAgentEvent("pre", "model", "模型已确认", {
      profile: profileName,
      source: "process.env",
      reason: "no_active_provider",
    });
    return env;
  }

  const { provider, apiKey } = result;
  const requestedModelId = normalizeOptionalModelId(
    memorySelectedModelId ?? defaultSelectedModelId
  );
  const effectiveModel = requestedModelId
    ? resolveProviderModel(provider, requestedModelId)
    : getEnabledProviderModels(provider)[0];
  if (!effectiveModel || (profileName === "memory" && !effectiveModel.enabled)) {
    throw new Error(`MODEL_NOT_CONFIGURED:${requestedModelId ?? ""}`);
  }
  const effectiveModelId = effectiveModel.id;

  logAgentEvent("pre", "model", "模型已确认", {
    profile: profileName,
    provider: provider.name,
    providerType: provider.providerType,
    model: effectiveModelId ?? "(default model)",
    selectedModel: requestedModelId ?? "(provider default)",
  });

  env = buildProviderSdkEnv({
    apiKey,
    baseUrl: provider.baseUrl,
    modelId: effectiveModelId,
    baseEnv: env,
  });
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "zora";

  return env;
}
