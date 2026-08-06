import type { RuntimeExecutionTarget } from "./runtime-execution-target";

export type PiApi = "anthropic-messages" | "openai-completions";

export interface PiProviderConfig {
  api: PiApi;
  baseUrl: string;
  apiKey: string;
  model: string;
  providerId: string;
}

export function buildPiProvider(
  target: RuntimeExecutionTarget
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
  };
}
