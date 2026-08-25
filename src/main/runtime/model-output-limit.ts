import type { ProviderConfig, ProviderModel } from "../../shared/types/provider";

const VOLC_PLAN_MODEL_MAX_TOKENS = new Map<string, number>([
  ["glm-5.3", 128_000],
  ["kimi-k3", 131_072],
  ["doubao-seed-evolving", 256_000],
  ["doubao-seed-2-1-turbo", 256_000],
  ["doubao-seed-2-1-turbo-260628", 256_000],
  ["doubao-seed-2.0-lite", 128_000],
  ["doubao-seed-2-0-lite-260215", 128_000],
]);

function isVolcPlanBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.hostname === "ark.cn-beijing.volces.com"
      && /^\/api\/(?:plan|coding)(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Returns an explicitly configured cap first. Known Volc Plan model limits
 * are only used for the Plan routes verified against their Anthropic APIs.
 */
export function resolveProviderModelMaxTokens(
  provider: Pick<ProviderConfig, "baseUrl">,
  model: ProviderModel
): number | undefined {
  if (model.maxTokens) return model.maxTokens;
  if (!isVolcPlanBaseUrl(provider.baseUrl)) return undefined;
  return VOLC_PLAN_MODEL_MAX_TOKENS.get(model.id);
}
