import type {
  ProviderConfig,
  ProviderProtocol,
  ProviderType,
  AgentRuntimeType,
} from "../../shared/types/provider";
import { getEnabledProviderModels, resolveProviderModel } from "../../shared/provider-model";
import { resolveProviderProtocol } from "../../shared/provider-protocol";
import { agentRuntimeSupportsProtocol } from "../../shared/runtime-capabilities";
import { providerManager } from "../provider-manager";
import { AgentRuntimeNotAvailableError } from "./types";
import { createRuntimeModelCapabilityResolver } from "../model-capability-service";

const DEFAULT_CONTEXT_WINDOW = 200_000;

interface RuntimeProviderTarget {
  id: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
}

export interface AgentRuntimeTarget {
  agentRuntimeType: AgentRuntimeType;
  provider: RuntimeProviderTarget;
  protocol: ProviderProtocol;
  modelId: string;
  contextWindow: number;
  maxTokens?: number;
}

interface RuntimeTargetSelection {
  agentRuntimeType: AgentRuntimeType;
  providerId?: string;
  selectedModelId?: string;
}

type RuntimeProviderLookup = (
  providerId: string
) => Promise<{ provider: ProviderConfig; apiKey: string } | null>;

function normalizeOptionalString(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export async function resolveAgentRuntimeTarget(
  selection: RuntimeTargetSelection,
  lookupProvider: RuntimeProviderLookup = (providerId) =>
    providerManager.getProviderByIdWithKey(providerId)
): Promise<AgentRuntimeTarget> {
  if (!selection.providerId?.trim()) {
    throw new AgentRuntimeNotAvailableError(
      selection.agentRuntimeType,
      "provider_not_found"
    );
  }
  const resolved = await lookupProvider(selection.providerId);
  if (!resolved) {
    throw new AgentRuntimeNotAvailableError(
      selection.agentRuntimeType,
      "provider_not_found"
    );
  }
  if (!resolved.provider.enabled) {
    throw new AgentRuntimeNotAvailableError(
      selection.agentRuntimeType,
      "provider_disabled"
    );
  }
  if (!normalizeOptionalString(resolved.apiKey)) {
    throw new AgentRuntimeNotAvailableError(
      selection.agentRuntimeType,
      "api_key_missing"
    );
  }
  if (!normalizeOptionalString(resolved.provider.baseUrl)) {
    throw new AgentRuntimeNotAvailableError(
      selection.agentRuntimeType,
      "base_url_missing"
    );
  }

  const requestedModelId = normalizeOptionalString(selection.selectedModelId);
  const model = requestedModelId
    ? resolveProviderModel(resolved.provider, requestedModelId)
    : getEnabledProviderModels(resolved.provider)[0];
  if (!model) {
    throw new AgentRuntimeNotAvailableError(selection.agentRuntimeType, "model_missing");
  }
  const modelId = model.id;

  const protocol = resolveProviderProtocol(resolved.provider);
  if (!agentRuntimeSupportsProtocol(selection.agentRuntimeType, protocol)) {
    throw new AgentRuntimeNotAvailableError(
      selection.agentRuntimeType,
      "protocol_not_supported"
    );
  }

  const catalogContextWindow = model.contextWindow == null
    ? (await createRuntimeModelCapabilityResolver()).resolveContextWindow(modelId)
    : undefined;
  const contextWindow = model.contextWindow
    ?? catalogContextWindow
    ?? DEFAULT_CONTEXT_WINDOW;
  const provider: RuntimeProviderTarget = {
    id: resolved.provider.id,
    name: resolved.provider.name,
    providerType: resolved.provider.providerType,
    baseUrl: resolved.provider.baseUrl,
    apiKey: resolved.apiKey,
  };
  return {
    agentRuntimeType: selection.agentRuntimeType,
    provider,
    protocol,
    modelId,
    contextWindow,
    maxTokens: model.maxTokens,
  };
}
