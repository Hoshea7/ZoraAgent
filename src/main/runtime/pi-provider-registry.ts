import type { AgentRuntimeTarget } from "./runtime-execution-target";
import type { ProviderType } from "../../shared/types/provider";

export type PiApi = "anthropic-messages" | "openai-completions";

export interface PiProviderConfig {
  api: PiApi;
  baseUrl: string;
  apiKey: string;
  model: string;
  providerId: string;
  supportsDeveloperRole: boolean;
  contextWindow: number;
  maxTokens?: number;
}

export function supportsPiDeveloperRole(providerType: ProviderType): boolean {
  return providerType === "openai";
}

export function buildPiProvider(
  target: AgentRuntimeTarget
): PiProviderConfig {
  return {
    api:
      target.protocol === "anthropic-messages"
        ? "anthropic-messages"
        : "openai-completions",
    baseUrl: target.provider.baseUrl,
    apiKey: target.provider.apiKey,
    model: target.modelId,
    providerId: target.provider.id,
    supportsDeveloperRole: supportsPiDeveloperRole(target.provider.providerType),
    contextWindow: target.contextWindow,
    maxTokens: target.maxTokens,
  };
}
