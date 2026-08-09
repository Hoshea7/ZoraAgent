import type { AgentUsage } from "./zora";

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function normalizeAgentUsage(value: unknown): AgentUsage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const usage = value as Record<string, unknown>;
  const hasTokenCounter = [
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
  ].some((key) => typeof usage[key] === "number");

  if (!hasTokenCounter) {
    return null;
  }

  return {
    inputTokens: tokenCount(usage.input_tokens),
    outputTokens: tokenCount(usage.output_tokens),
    cacheReadTokens: tokenCount(usage.cache_read_input_tokens),
    cacheWriteTokens: tokenCount(usage.cache_creation_input_tokens),
  };
}
