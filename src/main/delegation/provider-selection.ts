import type { AgentRuntimeType, AvailableSubtaskModel } from "../../shared/zora";
import { resolveProviderModelId } from "../../shared/provider-model";
import { resolveProviderProtocol } from "../../shared/provider-protocol";
import { getCompatibleAgentRuntimes } from "../../shared/runtime-capabilities";
import { providerManager } from "../provider-manager";

export async function resolveDelegationRuntimeTarget(input: {
  providerId: string;
  selectedModelId?: string;
  preferredRuntime: AgentRuntimeType;
}): Promise<{
  providerId: string;
  modelId: string;
  runtime: AgentRuntimeType;
}> {
  const provider = (await providerManager.list()).find(
    (item) => item.id === input.providerId && item.enabled
  );
  if (!provider) {
    throw new Error(
      `Provider target ${input.providerId} was not found. Call list_available_models and use its exact providerId; providerName cannot be used as providerId.`
    );
  }
  const modelId = resolveProviderModelId(provider, input.selectedModelId);
  if (!modelId) throw new Error(`Provider ${provider.name} has no usable model.`);
  const selectedModelId = input.selectedModelId?.trim();
  if (selectedModelId && modelId !== selectedModelId) {
    throw new Error(
      `Model ${selectedModelId} is not available for Provider ${provider.name}. Call list_available_models and use an exact providerId/modelId pair from the same candidate.`
    );
  }
  const compatible = getCompatibleAgentRuntimes(resolveProviderProtocol(provider));
  const runtime = compatible.includes(input.preferredRuntime)
    ? input.preferredRuntime
    : compatible[0];
  if (!runtime) throw new Error(`Provider ${provider.name} has no compatible runtime.`);
  return { providerId: provider.id, modelId, runtime };
}

export async function listAvailableSubtaskModels(input: {
  currentProviderId: string;
  currentModelId: string;
  preferredRuntime: AgentRuntimeType;
}): Promise<AvailableSubtaskModel[]> {
  const providers = (await providerManager.list()).filter((provider) => provider.enabled);
  return providers.flatMap((provider) => {
    const protocol = resolveProviderProtocol(provider);
    const supportedRuntimes = getCompatibleAgentRuntimes(protocol);
    if (supportedRuntimes.length === 0) return [];
    const modelIds = new Set(
      [
        provider.modelId,
        ...Object.values(provider.roleModels ?? {}),
      ].filter((model): model is string => typeof model === "string" && model.trim().length > 0)
    );
    return [...modelIds].map((modelId) => ({
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.providerType,
      protocol,
      modelId,
      supportedRuntimes,
      defaultRuntime: supportedRuntimes.includes(input.preferredRuntime)
        ? input.preferredRuntime
        : supportedRuntimes[0],
      isCurrent:
        provider.id === input.currentProviderId && modelId === input.currentModelId,
    }));
  });
}
