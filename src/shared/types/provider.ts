export type ProviderType =
  | "anthropic"
  | "volcengine"
  | "zhipu"
  | "moonshot"
  | "deepseek"
  | "custom";

export interface RoleModels {
  /** ANTHROPIC_SMALL_FAST_MODEL — 压缩/快速任务 */
  smallFastModel?: string;
  /** ANTHROPIC_DEFAULT_SONNET_MODEL — sonnet 别名子 agent（如 Explore） */
  sonnetModel?: string;
  /** ANTHROPIC_DEFAULT_OPUS_MODEL — opus 别名子 agent（如 Plan） */
  opusModel?: string;
  /** ANTHROPIC_DEFAULT_HAIKU_MODEL — haiku 别名子 agent（轻量任务） */
  haikuModel?: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  modelId?: string;
  roleModels?: RoleModels;
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
  roleModels?: RoleModels;
}

export interface ProviderUpdateInput {
  name?: string;
  providerType?: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  roleModels?: RoleModels;
  enabled?: boolean;
}

export interface ProviderTestResult {
  success: boolean;
  message: string;
}

export type ProviderTestRoleKey =
  | "main"
  | "sonnet"
  | "opus"
  | "haiku"
  | "small";

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

export interface RoleTestDetail {
  /** 测试结果对应的输入字段 */
  role: ProviderTestRoleKey;
  /** 实际测试的模型 ID */
  modelId: string;
  success: boolean;
  message: string;
}

export interface ProviderTestResultWithRoles {
  /** 全部角色通过才为 true */
  success: boolean;
  /** 总结消息，如 "共测试 3 个模型，全部连接成功" */
  message: string;
  /** 每个已填写字段的独立测试结果 */
  details: RoleTestDetail[];
}
