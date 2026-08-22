import type {
  ProviderConfig,
  ProviderPresetId,
  ProviderProtocol,
  ProviderType,
} from "./types/provider";

export interface ProviderPreset {
  id: ProviderPresetId;
  label: string;
  providerType: ProviderType;
  protocol: ProviderProtocol;
  defaultUrl: string;
  description?: string;
}

export const PROVIDER_PRESETS: Record<ProviderPresetId, ProviderPreset> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    providerType: "anthropic",
    protocol: "anthropic-messages",
    defaultUrl: "https://api.anthropic.com",
  },
  "volcengine-compatible": {
    id: "volcengine-compatible",
    label: "火山引擎（Anthropic 兼容）",
    providerType: "volcengine",
    protocol: "anthropic-messages",
    defaultUrl: "https://ark.cn-beijing.volces.com/api/compatible",
  },
  "volcengine-coding-plan": {
    id: "volcengine-coding-plan",
    label: "火山 Coding Plan",
    providerType: "volcengine",
    protocol: "anthropic-messages",
    defaultUrl: "https://ark.cn-beijing.volces.com/api/coding",
  },
  "volcengine-agent-plan-anthropic": {
    id: "volcengine-agent-plan-anthropic",
    label: "火山 Agent Plan（Anthropic）",
    providerType: "volcengine",
    protocol: "anthropic-messages",
    defaultUrl: "https://ark.cn-beijing.volces.com/api/plan",
  },
  "volcengine-agent-plan-openai": {
    id: "volcengine-agent-plan-openai",
    label: "火山 Agent Plan（OpenAI）",
    providerType: "volcengine",
    protocol: "openai-completions",
    defaultUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
  },
  zhipu: {
    id: "zhipu",
    label: "智谱 AI",
    providerType: "zhipu",
    protocol: "openai-completions",
    defaultUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  moonshot: {
    id: "moonshot",
    label: "Kimi",
    providerType: "moonshot",
    protocol: "openai-completions",
    defaultUrl: "https://api.moonshot.cn/v1",
  },
  minimax: {
    id: "minimax",
    label: "MiniMax",
    providerType: "minimax",
    protocol: "openai-completions",
    defaultUrl: "https://api.minimaxi.com/v1",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    providerType: "deepseek",
    protocol: "openai-completions",
    defaultUrl: "https://api.deepseek.com",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    providerType: "openai",
    protocol: "openai-completions",
    defaultUrl: "https://api.openai.com/v1",
  },
  custom: {
    id: "custom",
    label: "自定义",
    providerType: "custom",
    protocol: "openai-completions",
    defaultUrl: "",
    description: "协议与接口地址需要由用户明确配置。",
  },
};

const DEFAULT_PRESET_BY_PROVIDER_TYPE: Record<ProviderType, ProviderPresetId> = {
  anthropic: "anthropic",
  volcengine: "volcengine-compatible",
  zhipu: "zhipu",
  moonshot: "moonshot",
  minimax: "minimax",
  deepseek: "deepseek",
  openai: "openai",
  custom: "custom",
};

export function isProviderPresetId(value: unknown): value is ProviderPresetId {
  return typeof value === "string" && value in PROVIDER_PRESETS;
}

export function getDefaultProviderPreset(providerType: ProviderType): ProviderPreset {
  return PROVIDER_PRESETS[DEFAULT_PRESET_BY_PROVIDER_TYPE[providerType]];
}

export function resolveProviderPreset(
  provider: Pick<ProviderConfig, "presetId" | "providerType" | "baseUrl" | "protocol">
): ProviderPreset {
  if (provider.presetId && isProviderPresetId(provider.presetId)) {
    return PROVIDER_PRESETS[provider.presetId];
  }

  const matchingPreset = Object.values(PROVIDER_PRESETS).find(
    (preset) =>
      preset.providerType === provider.providerType &&
      preset.defaultUrl === provider.baseUrl &&
      (provider.protocol === undefined || preset.protocol === provider.protocol)
  );
  if (matchingPreset) {
    return matchingPreset;
  }

  const defaultPreset = getDefaultProviderPreset(provider.providerType);
  if (
    provider.protocol === undefined ||
    defaultPreset.protocol === provider.protocol
  ) {
    return defaultPreset;
  }

  return PROVIDER_PRESETS.custom;
}
