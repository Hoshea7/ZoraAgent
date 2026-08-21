import type { AgentRuntimeType, AvailableSubtaskModel } from "../../shared/zora";
import { getEnabledProviderModels, resolveProviderModel } from "../../shared/provider-model";
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
  const requestedModelId = input.selectedModelId?.trim();
  const resolvedModel = requestedModelId
    ? resolveProviderModel(provider, requestedModelId)
    : getEnabledProviderModels(provider)[0];
  const modelId = resolvedModel?.enabled ? resolvedModel.id : undefined;
  if (requestedModelId && !modelId) {
    throw new Error(
      `Model ${requestedModelId} is not available for Provider ${provider.name}. Call list_available_models and use an exact providerId/modelId pair from the same candidate.`
    );
  }
  if (!modelId) throw new Error(`Provider ${provider.name} has no usable model.`);
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
    return getEnabledProviderModels(provider).map((model) => ({
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.providerType,
      protocol,
      modelId: model.id,
      supportedRuntimes,
      defaultRuntime: supportedRuntimes.includes(input.preferredRuntime)
        ? input.preferredRuntime
        : supportedRuntimes[0],
      isCurrent:
        provider.id === input.currentProviderId && model.id === input.currentModelId,
    }));
  });
}
