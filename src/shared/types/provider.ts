export type ProviderType =
  | "anthropic"
  | "volcengine"
  | "zhipu"
  | "moonshot"
  | "deepseek"
  | "openai"
  | "custom";

export type AgentRuntimeType = "claude" | "pi";

/**
 * 推理强度，与 Runtime 无关的意图声明。
 * Adapter 负责翻译为各 Runtime 的具体参数格式。
 *
 * 三档制：off（关闭）/ high（标准）/ max（最大）。
 * 两个 SDK 均原生支持 "max"，不做静默降级。
 */
export type ReasoningLevel = "off" | "high" | "max";

export const REASONING_LEVELS = ["off", "high", "max"] as const;

export const DEFAULT_REASONING_LEVEL: ReasoningLevel = "high";

export type ProviderProtocol = "anthropic-messages" | "openai-completions";

export type ProviderPresetId =
  | "anthropic"
  | "volcengine-compatible"
  | "volcengine-coding-plan"
  | "volcengine-agent-plan-anthropic"
  | "volcengine-agent-plan-openai"
  | "zhipu"
  | "moonshot"
  | "deepseek"
  | "openai"
  | "custom";

export interface ProviderModel {
  id: string;
  name?: string;
  enabled: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  models: ProviderModel[];
  presetId?: ProviderPresetId;
  protocol?: ProviderProtocol;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderCreateInput {
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  models: ProviderModel[];
  presetId?: ProviderPresetId;
  protocol?: ProviderProtocol;
  enabled?: boolean;
}

export interface ProviderUpdateInput {
  name?: string;
  providerType?: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  models?: ProviderModel[];
  presetId?: ProviderPresetId;
  protocol?: ProviderProtocol;
  enabled?: boolean;
}

export interface ProviderTestResult {
  success: boolean;
  message: string;
}
