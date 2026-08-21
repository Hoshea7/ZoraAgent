import type { AgentRuntimeTarget } from "./runtime-execution-target";

export type PiApi = "anthropic-messages" | "openai-completions";

export interface PiProviderConfig {
  api: PiApi;
  baseUrl: string;
  apiKey: string;
  model: string;
  providerId: string;
  contextWindow: number;
  maxTokens?: number;
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
    contextWindow: target.contextWindow,
    maxTokens: target.maxTokens,
  };
}
