export type ProviderType =
  | "anthropic"
  | "volcengine"
  | "zhipu"
  | "moonshot"
  | "deepseek"
  | "custom";

export interface ProviderConfig {
  id: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  modelId?: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderCreateInput {
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  modelId?: string;
}

export interface ProviderUpdateInput {
  name?: string;
  providerType?: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  enabled?: boolean;
}

export interface ProviderTestResult {
  success: boolean;
  message: string;
}

export const PROVIDER_PRESETS: Record<
  ProviderType,
  { label: string; defaultUrl: string }
> = {
  anthropic: {
    label: "Anthropic",
    defaultUrl: "https://api.anthropic.com",
  },
  volcengine: {
    label: "火山引擎",
    defaultUrl: "https://ark.cn-beijing.volces.com/api/compatible",
  },
  zhipu: {
    label: "智谱AI",
    defaultUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  moonshot: {
    label: "Kimi",
    defaultUrl: "https://api.moonshot.cn/v1",
  },
  deepseek: {
    label: "DeepSeek",
    defaultUrl: "https://api.deepseek.com",
  },
  custom: {
    label: "自定义",
    defaultUrl: "",
  },
};
