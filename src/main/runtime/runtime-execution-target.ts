import type {
  ProviderConfig,
  ProviderProtocol,
  ProviderType,
  AgentRuntimeType,
} from "../../shared/types/provider";
import { getEnabledProviderModels, resolveProviderModel } from "../../shared/provider-model";
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

interface ResolvedRuntimeTargetSelection {
  agentRuntimeType: AgentRuntimeType;
  provider: ProviderConfig;
  apiKey: string;
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
  return resolveAgentRuntimeTargetFromProvider({
    agentRuntimeType: selection.agentRuntimeType,
    provider: resolved.provider,
    apiKey: resolved.apiKey,
    selectedModelId: selection.selectedModelId,
  });
}

/**
 * Resolves a runnable target from an already-loaded Provider.
 *
 * Saved sessions and draft Provider probes both use this boundary so protocol,
 * model state, credentials, and model capabilities cannot drift between paths.
 */
export async function resolveAgentRuntimeTargetFromProvider(
  selection: ResolvedRuntimeTargetSelection
): Promise<AgentRuntimeTarget> {
  if (!selection.provider.enabled) {
    throw new AgentRuntimeNotAvailableError(
      selection.agentRuntimeType,
      "provider_disabled"
    );
  }
  if (!normalizeOptionalString(selection.apiKey)) {
    throw new AgentRuntimeNotAvailableError(
      selection.agentRuntimeType,
      "api_key_missing"
    );
  }
  if (!normalizeOptionalString(selection.provider.baseUrl)) {
    throw new AgentRuntimeNotAvailableError(
      selection.agentRuntimeType,
      "base_url_missing"
    );
  }

  const requestedModelId = normalizeOptionalString(selection.selectedModelId);
  const model = requestedModelId
    ? resolveProviderModel(selection.provider, requestedModelId)
    : getEnabledProviderModels(selection.provider)[0];
  if (!model) {
    throw new AgentRuntimeNotAvailableError(selection.agentRuntimeType, "model_missing");
  }
  if (!model.enabled) {
    throw new AgentRuntimeNotAvailableError(selection.agentRuntimeType, "model_disabled");
  }
  const modelId = model.id;

  const protocol = selection.provider.protocol;
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
    id: selection.provider.id,
    name: selection.provider.name,
    providerType: selection.provider.providerType,
    baseUrl: selection.provider.baseUrl,
    apiKey: selection.apiKey,
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
