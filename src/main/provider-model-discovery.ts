import type { FetchedProviderModel } from "../shared/provider-model";
import type { ProviderProtocol } from "../shared/types/provider";

const DISCOVERY_TIMEOUT_MS = 30_000;

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function buildProviderModelsUrl(
  baseUrl: string,
  protocol: ProviderProtocol
): string {
  const url = new URL(baseUrl.trim());
  const path = url.pathname.replace(/\/+$/, "");
  if (protocol === "anthropic-messages" && !/(^|\/)v1$/i.test(path)) {
    url.pathname = `${path}/v1/models`.replace(/\/{2,}/g, "/");
  } else {
    url.pathname = `${path}/models`.replace(/\/{2,}/g, "/");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function parseProviderModelsResponse(value: unknown): FetchedProviderModel[] {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    throw new Error("模型列表响应格式无效。");
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("模型列表响应格式无效。");
  }
  const models: FetchedProviderModel[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (typeof row !== "object" || row === null) continue;
    const source = row as Record<string, unknown>;
    const id = normalizeOptionalString(source.id);
    if (!id || seen.has(id)) continue;
    const name = normalizeOptionalString(source.display_name) ?? normalizeOptionalString(source.name);
    models.push({ id, ...(name ? { name } : {}) });
    seen.add(id);
  }
  return models;
}

export async function fetchProviderModels(
  baseUrl: string,
  apiKey: string,
  protocol: ProviderProtocol,
  fetchImpl: typeof fetch = fetch
): Promise<FetchedProviderModel[]> {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) throw new Error("API Key is required.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const headers: Record<string, string> =
      protocol === "anthropic-messages"
        ? {
            "x-api-key": normalizedApiKey,
            "anthropic-version": "2023-06-01",
          }
        : { Authorization: `Bearer ${normalizedApiKey}` };
    const response = await fetchImpl(buildProviderModelsUrl(baseUrl, protocol), {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`获取模型失败（HTTP ${response.status}）。`);
    }
    return parseProviderModelsResponse(await response.json());
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("获取模型超时，请检查网络和 Provider 配置。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
