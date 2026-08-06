import type {
  ProviderConfig,
  ProviderProtocol,
  ProviderType,
  RoleModels,
  RuntimeType,
} from "../../shared/types/provider";
import { resolveProviderModelId } from "../../shared/provider-model";
import { resolveProviderProtocol } from "../../shared/provider-protocol";
import { runtimeSupportsProtocol } from "../../shared/runtime-capabilities";
import { providerManager } from "../provider-manager";
import { RuntimeNotAvailableError } from "./types";

interface RuntimeProviderTarget {
  id: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  roleModels?: RoleModels;
}

export interface RuntimeExecutionTarget {
  runtimeType: RuntimeType;
  provider: RuntimeProviderTarget;
  protocol: ProviderProtocol;
  modelId: string;
}

interface RuntimeTargetSelection {
  runtimeType: RuntimeType;
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

export async function resolveRuntimeExecutionTarget(
  selection: RuntimeTargetSelection,
  lookupProvider: RuntimeProviderLookup = (providerId) =>
    providerManager.getProviderByIdWithKey(providerId)
): Promise<RuntimeExecutionTarget> {
  if (!selection.providerId?.trim()) {
    throw new RuntimeNotAvailableError(
      selection.runtimeType,
      "provider_not_found"
    );
  }
  const resolved = await lookupProvider(selection.providerId);
  if (!resolved) {
    throw new RuntimeNotAvailableError(
      selection.runtimeType,
      "provider_not_found"
    );
  }
  if (!resolved.provider.enabled) {
    throw new RuntimeNotAvailableError(
      selection.runtimeType,
      "provider_disabled"
    );
  }
  if (!normalizeOptionalString(resolved.apiKey)) {
    throw new RuntimeNotAvailableError(
      selection.runtimeType,
      "api_key_missing"
    );
  }
  if (!normalizeOptionalString(resolved.provider.baseUrl)) {
    throw new RuntimeNotAvailableError(
      selection.runtimeType,
      "base_url_missing"
    );
  }

  const modelId = resolveProviderModelId(
    resolved.provider,
    selection.selectedModelId
  );
  if (!modelId) {
    throw new RuntimeNotAvailableError(selection.runtimeType, "model_missing");
  }

  const protocol = resolveProviderProtocol(resolved.provider);
  if (!runtimeSupportsProtocol(selection.runtimeType, protocol)) {
    throw new RuntimeNotAvailableError(
      selection.runtimeType,
      "protocol_not_supported"
    );
  }

  const provider: RuntimeProviderTarget = {
    id: resolved.provider.id,
    name: resolved.provider.name,
    providerType: resolved.provider.providerType,
    baseUrl: resolved.provider.baseUrl,
    apiKey: resolved.apiKey,
    roleModels: resolved.provider.roleModels,
  };
  return {
    runtimeType: selection.runtimeType,
    provider,
    protocol,
    modelId,
  };
}
