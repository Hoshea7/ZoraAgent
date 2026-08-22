import type { FetchedProviderModel } from "../shared/provider-model";
import type {
  ProviderPresetId,
  ProviderModelDiscoveryInput,
  ProviderProtocol,
} from "../shared/types/provider";

const DISCOVERY_TIMEOUT_MS = 30_000;

const ARK_CODING_PLAN_MODELS: FetchedProviderModel[] = [
  { id: "doubao-seed-2.0-code", name: "Doubao Seed 2.0 Code" },
  { id: "doubao-seed-2.0-pro", name: "Doubao Seed 2.0 Pro" },
  { id: "doubao-seed-2.0-lite", name: "Doubao Seed 2.0 Lite" },
  { id: "glm-5.3", name: "GLM-5.3" },
  { id: "glm-5.2", name: "GLM-5.2" },
  { id: "k3", name: "Kimi K3" },
  { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
  { id: "minimax-m3", name: "MiniMax M3" },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
];

const ARK_AGENT_PLAN_MODELS: FetchedProviderModel[] = [
  { id: "glm-5.3", name: "GLM-5.3" },
  { id: "glm-5.2", name: "GLM-5.2" },
  { id: "doubao-seed-evolving", name: "Doubao Seed Evolving" },
  { id: "doubao-seed-2.0-pro", name: "Doubao Seed 2.0 Pro" },
  { id: "kimi-k3", name: "Kimi K3" },
];

interface RemoteDiscoveryRequest {
  url: string;
  headers: Record<string, string>;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function replacePathSuffix(url: URL, suffix: RegExp, replacement: string): URL {
  url.pathname = url.pathname.replace(suffix, replacement);
  url.search = "";
  url.hash = "";
  return url;
}

function appendModelsPath(baseUrl: string, protocol: ProviderProtocol): string {
  const url = new URL(baseUrl.trim());
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/models$/i.test(path)) {
    url.pathname = path;
  } else if (/\/(chat\/completions|responses)$/i.test(path)) {
    replacePathSuffix(url, /\/(chat\/completions|responses)$/i, "/models");
  } else if (/\/messages$/i.test(path)) {
    replacePathSuffix(url, /\/messages$/i, "/models");
  } else if (protocol === "anthropic-messages" && !/(^|\/)v1$/i.test(path)) {
    url.pathname = `${path}/v1/models`.replace(/\/{2,}/g, "/");
  } else {
    url.pathname = `${path}/models`.replace(/\/{2,}/g, "/");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function originModelsUrl(baseUrl: string, versioned: boolean): string {
  const origin = new URL(baseUrl.trim()).origin;
  return `${origin}${versioned ? "/v1" : ""}/models`;
}

function bearerHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function anthropicHeaders(
  apiKey: string,
  includeBearer: boolean
): Record<string, string> {
  return {
    Accept: "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": apiKey,
    ...(includeBearer ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function buildRemoteRequest(
  input: ProviderModelDiscoveryInput,
  apiKey: string,
  presetId: ProviderPresetId
): RemoteDiscoveryRequest {
  switch (presetId) {
    case "deepseek":
      return { url: originModelsUrl(input.baseUrl, false), headers: bearerHeaders(apiKey) };
    case "moonshot":
    case "minimax":
      return { url: originModelsUrl(input.baseUrl, true), headers: bearerHeaders(apiKey) };
    case "volcengine-compatible":
      return {
        url: appendModelsPath(input.baseUrl, "anthropic-messages"),
        headers: anthropicHeaders(apiKey, true),
      };
    case "anthropic":
      return {
        url: appendModelsPath(input.baseUrl, "anthropic-messages"),
        headers: anthropicHeaders(apiKey, false),
      };
    case "custom":
      return input.protocol === "anthropic-messages"
        ? {
            url: appendModelsPath(input.baseUrl, input.protocol),
            headers: anthropicHeaders(apiKey, true),
          }
        : {
            url: appendModelsPath(input.baseUrl, input.protocol),
            headers: bearerHeaders(apiKey),
          };
    default:
      return {
        url: appendModelsPath(input.baseUrl, input.protocol),
        headers:
          input.protocol === "anthropic-messages"
            ? anthropicHeaders(apiKey, true)
            : bearerHeaders(apiKey),
      };
  }
}

function inferPresetId(input: ProviderModelDiscoveryInput): ProviderPresetId {
  if (input.presetId !== "custom") return input.presetId;
  const url = new URL(input.baseUrl.trim());
  const hostname = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (hostname === "api.deepseek.com") return "deepseek";
  if (hostname === "api.moonshot.cn" || hostname === "api.moonshot.ai") return "moonshot";
  if (hostname === "api.minimaxi.com") return "minimax";
  if (hostname.endsWith("volces.com")) {
    if (path.includes("/coding")) return "volcengine-coding-plan";
    if (path.includes("/plan")) {
      return input.protocol === "openai-completions"
        ? "volcengine-agent-plan-openai"
        : "volcengine-agent-plan-anthropic";
    }
    if (path.includes("/compatible")) return "volcengine-compatible";
  }
  return "custom";
}

function getPresetModels(presetId: ProviderPresetId): FetchedProviderModel[] | null {
  if (presetId === "volcengine-coding-plan") return ARK_CODING_PLAN_MODELS;
  if (
    presetId === "volcengine-agent-plan-anthropic" ||
    presetId === "volcengine-agent-plan-openai"
  ) {
    return ARK_AGENT_PLAN_MODELS;
  }
  return null;
}

export function parseProviderModelsResponse(value: unknown): FetchedProviderModel[] {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    throw new Error("模型列表响应格式无效。");
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error("模型列表响应格式无效。");

  const models: FetchedProviderModel[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (typeof row !== "object" || row === null) continue;
    const source = row as Record<string, unknown>;
    const id = normalizeOptionalString(source.id);
    const status = normalizeOptionalString(source.status)?.toLowerCase();
    if (!id || seen.has(id) || status === "shutdown" || status === "disabled") continue;
    const name =
      normalizeOptionalString(source.display_name) ?? normalizeOptionalString(source.name);
    models.push({ id, ...(name && name !== id ? { name } : {}) });
    seen.add(id);
  }
  return models;
}

export async function fetchProviderModels(
  input: ProviderModelDiscoveryInput,
  fetchImpl: typeof fetch = fetch
): Promise<FetchedProviderModel[]> {
  const presetId = inferPresetId(input);
  const presetModels = getPresetModels(presetId);
  if (presetModels) return presetModels.map((model) => ({ ...model }));

  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("API Key is required.");
  const request = buildRemoteRequest(input, apiKey, presetId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(request.url, {
      method: "GET",
      headers: request.headers,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`获取模型失败（HTTP ${response.status}）。`);
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
