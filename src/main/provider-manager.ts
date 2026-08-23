import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ProviderConfig,
  ProviderCreateInput,
  ProviderProtocol,
  ProviderModelsTestInput,
  ProviderModelsTestResult,
  ProviderType,
  ProviderUpdateInput,
} from "../shared/types/provider";
import { getEnabledProviderModels } from "../shared/provider-model";
import {
  getDefaultProviderPreset,
  isProviderPresetId,
  PROVIDER_PRESETS,
  resolveProviderPreset,
} from "../shared/provider-presets";
import { logSystemEvent } from "./system-log";
import { replaceFileAtomically, ZORA_DIR } from "./utils/fs";
import { readSecret, storeSecret } from "./utils/secret-storage";
import {
  parseProviderConfigFile,
  parseProviderModels,
  PROVIDER_CONFIG_VERSION,
} from "./provider-config";
import {
  providerModelProbeRunner,
} from "./provider-model-probe";

const MASKED_API_KEY = "••••••";
const PROVIDERS_FILE = path.join(ZORA_DIR, "providers.json");
const OFFICIAL_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const PROVIDER_TYPES = new Set<ProviderType>([
  "anthropic",
  "volcengine",
  "zhipu",
  "moonshot",
  "minimax",
  "deepseek",
  "openai",
  "custom",
]);

type StringRecord = Record<string, string>;
type JsonRecord = Record<string, unknown>;

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalContextWindow(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Context window must be a positive number.");
  }
  return Math.floor(value);
}

function isProviderType(value: unknown): value is ProviderType {
  return typeof value === "string" && PROVIDER_TYPES.has(value as ProviderType);
}

function isProviderProtocol(value: unknown): value is ProviderProtocol {
  return value === "anthropic-messages" || value === "openai-completions";
}

function sanitizeProvider(provider: ProviderConfig): ProviderConfig {
  const preset = resolveProviderPreset(provider);
  const sanitized: ProviderConfig = {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    presetId: preset.id,
    protocol: provider.protocol,
    models: parseProviderModels(provider.models),
    enabled: provider.enabled,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };

  return sanitized;
}

function toStringRecord(source: NodeJS.ProcessEnv | Record<string, string>): StringRecord {
  const result: StringRecord = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }

  return result;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

export function buildProviderSdkEnv({
  apiKey,
  baseUrl,
  modelId,
  baseEnv = process.env,
}: {
  apiKey: string;
  baseUrl: string;
  modelId?: string;
  baseEnv?: NodeJS.ProcessEnv | Record<string, string>;
}): StringRecord {
  const env = toStringRecord(baseEnv);
  const normalizedBaseUrl = baseUrl.trim();
  const normalizedModelId = normalizeOptionalString(modelId);

  env.ANTHROPIC_API_KEY = apiKey;
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_MODEL;

  if (normalizedBaseUrl.length > 0 && normalizedBaseUrl !== OFFICIAL_ANTHROPIC_BASE_URL) {
    env.ANTHROPIC_BASE_URL = normalizedBaseUrl;
  }

  if (normalizedModelId) {
    env.ANTHROPIC_MODEL = normalizedModelId;
  }

  const roleEnvVars = [
    "ANTHROPIC_SMALL_FAST_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  ];

  for (const envVar of roleEnvVars) {
    delete env[envVar];
    if (normalizedModelId) {
      env[envVar] = normalizedModelId;
    }
  }

  // 第三方 provider 禁用实验性 beta header
  const isThirdParty =
    normalizedBaseUrl.length > 0 &&
    normalizedBaseUrl !== OFFICIAL_ANTHROPIC_BASE_URL;
  if (isThirdParty) {
    env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1";
  }

  return env;
}

export class ProviderManager {
  cancelTestRun(testRunId: string): Promise<boolean> {
    const normalizedTestRunId = normalizeRequiredString(testRunId, "Test run ID");
    logSystemEvent(
      "provider",
      "test",
      "cancel",
      "取消模型连接测试",
      { testRunId: normalizedTestRunId }
    );
    return providerModelProbeRunner.cancel(normalizedTestRunId);
  }

  private async readProviders(): Promise<ProviderConfig[]> {
    try {
      const raw = await readFile(PROVIDERS_FILE, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      return parseProviderConfigFile(parsed).providers.map(sanitizeProvider);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        return [];
      }

      throw error;
    }
  }

  private async writeProviders(providers: ProviderConfig[]): Promise<void> {
    const file = {
      version: PROVIDER_CONFIG_VERSION,
      providers: providers.map(sanitizeProvider),
    };
    await replaceFileAtomically(PROVIDERS_FILE, `${JSON.stringify(file, null, 2)}\n`);
  }

  private encryptApiKey(plainKey: string): string {
    return storeSecret(plainKey);
  }

  private decryptApiKeyValue(encryptedKey: string): string {
    return readSecret(encryptedKey);
  }

  private maskProvider(provider: ProviderConfig): ProviderConfig {
    return {
      ...provider,
      apiKey: MASKED_API_KEY,
    };
  }

  async list(): Promise<ProviderConfig[]> {
    const providers = await this.readProviders();
    return providers.map((provider) => this.maskProvider(provider));
  }

  async create(input: ProviderCreateInput): Promise<ProviderConfig> {
    if (!isProviderType(input.providerType)) {
      throw new Error("A valid providerType is required.");
    }

    if (input.presetId !== undefined && !isProviderPresetId(input.presetId)) {
      throw new Error("A valid presetId is required.");
    }
    if (input.protocol !== undefined && !isProviderProtocol(input.protocol)) {
      throw new Error("A valid provider protocol is required.");
    }

    const preset = input.presetId
      ? PROVIDER_PRESETS[input.presetId]
      : getDefaultProviderPreset(input.providerType);
    if (preset.providerType !== input.providerType) {
      throw new Error("Provider preset does not match providerType.");
    }
    if (
      preset.id !== "custom" &&
      input.protocol !== undefined &&
      input.protocol !== preset.protocol
    ) {
      throw new Error("Provider protocol does not match the selected preset.");
    }

    const providers = await this.readProviders();
    const now = Date.now();
    const models = parseProviderModels(input.models);
    const enabled = input.enabled ?? true;
    const provider: ProviderConfig = {
      id: randomUUID(),
      name: normalizeRequiredString(input.name, "Provider name"),
      providerType: input.providerType,
      baseUrl: normalizeRequiredString(input.baseUrl, "Base URL"),
      apiKey: this.encryptApiKey(normalizeRequiredString(input.apiKey, "API Key")),
      models,
      presetId: preset.id,
      protocol: input.protocol ?? preset.protocol,
      enabled,
      createdAt: now,
      updatedAt: now,
    };

    const nextProviders = [...providers, provider];
    await this.writeProviders(nextProviders);

    const createdProvider = nextProviders.find((item) => item.id === provider.id);
    if (!createdProvider) {
      throw new Error("Failed to create provider.");
    }

    return this.maskProvider(createdProvider);
  }

  async update(id: string, input: ProviderUpdateInput): Promise<ProviderConfig> {
    const providerId = normalizeRequiredString(id, "Provider ID");
    const providers = await this.readProviders();
    const index = providers.findIndex((provider) => provider.id === providerId);

    if (index === -1) {
      throw new Error("Provider not found.");
    }

    if (input.providerType !== undefined && !isProviderType(input.providerType)) {
      throw new Error("A valid providerType is required.");
    }
    if (input.presetId !== undefined && !isProviderPresetId(input.presetId)) {
      throw new Error("A valid presetId is required.");
    }
    if (input.protocol !== undefined && !isProviderProtocol(input.protocol)) {
      throw new Error("A valid provider protocol is required.");
    }

    const currentProvider = providers[index];
    const selectedPreset = input.presetId
      ? PROVIDER_PRESETS[input.presetId]
      : undefined;
    const nextProviderType =
      selectedPreset?.providerType ?? input.providerType ?? currentProvider.providerType;
    if (
      selectedPreset &&
      input.providerType !== undefined &&
      input.providerType !== selectedPreset.providerType
    ) {
      throw new Error("Provider preset does not match providerType.");
    }
    if (
      selectedPreset &&
      selectedPreset.id !== "custom" &&
      input.protocol !== undefined &&
      input.protocol !== selectedPreset.protocol
    ) {
      throw new Error("Provider protocol does not match the selected preset.");
    }
    const nextPreset =
      selectedPreset ??
      (nextProviderType !== currentProvider.providerType
        ? getDefaultProviderPreset(nextProviderType)
        : resolveProviderPreset(currentProvider));
    const nextProtocol = input.protocol ?? nextPreset.protocol;
    if (nextPreset.id !== "custom" && nextProtocol !== nextPreset.protocol) {
      throw new Error("Provider protocol does not match the selected preset.");
    }
    const nextProvider: ProviderConfig = {
      ...currentProvider,
      name:
        input.name !== undefined
          ? normalizeRequiredString(input.name, "Provider name")
          : currentProvider.name,
      providerType: nextProviderType,
      presetId: nextPreset.id,
      protocol: nextProtocol,
      baseUrl:
        input.baseUrl !== undefined
          ? normalizeRequiredString(input.baseUrl, "Base URL")
          : currentProvider.baseUrl,
      models:
        input.models !== undefined
          ? parseProviderModels(input.models)
          : currentProvider.models,
      enabled: typeof input.enabled === "boolean" ? input.enabled : currentProvider.enabled,
      updatedAt: Date.now(),
    };

    const nextApiKey = normalizeOptionalString(input.apiKey);
    if (nextApiKey) {
      nextProvider.apiKey = this.encryptApiKey(nextApiKey);
    }

    const nextProviders = [...providers];
    nextProviders[index] = nextProvider;

    await this.writeProviders(nextProviders);

    const updatedProvider = nextProviders.find((provider) => provider.id === providerId);
    if (!updatedProvider) {
      throw new Error("Provider not found after update.");
    }

    return this.maskProvider(updatedProvider);
  }

  async delete(id: string): Promise<void> {
    const providerId = normalizeRequiredString(id, "Provider ID");
    const providers = await this.readProviders();
    const nextProviders = providers.filter((provider) => provider.id !== providerId);

    if (nextProviders.length === providers.length) {
      throw new Error("Provider not found.");
    }

    await this.writeProviders(nextProviders);
  }

  async decryptApiKey(providerId: string): Promise<string | null> {
    const id = normalizeRequiredString(providerId, "Provider ID");
    const providers = await this.readProviders();
    const provider = providers.find((item) => item.id === id);

    if (!provider) {
      return null;
    }

    return this.decryptApiKeyValue(provider.apiKey);
  }

  async getProviderByIdWithKey(
    providerId: string
  ): Promise<{ provider: ProviderConfig; apiKey: string } | null> {
    const id = normalizeRequiredString(providerId, "Provider ID");
    const providers = await this.readProviders();
    const provider = providers.find((p) => p.id === id) ?? null;

    if (!provider) {
      return null;
    }

    const apiKey = this.decryptApiKeyValue(provider.apiKey);
    return { provider, apiKey };
  }

  async hasConfigured(): Promise<boolean> {
    const providers = await this.readProviders();
    return providers.some(
      (provider) => provider.enabled && getEnabledProviderModels(provider).length > 0
    );
  }

  async testModels(input: ProviderModelsTestInput): Promise<ProviderModelsTestResult> {
    if (input.providerId) {
      const configuredProvider = (await this.readProviders()).find(
        (provider) => provider.id === input.providerId
      );
      if (!configuredProvider) {
        throw new Error("Provider not found.");
      }
      if (!configuredProvider.enabled) {
        throw new Error("Provider is disabled.");
      }
    }
    const models = parseProviderModels(input.models).filter((model) => model.enabled);
    if (models.length === 0) {
      throw new Error("At least one model ID is required.");
    }
    return providerModelProbeRunner.testModels({
      ...input,
      baseUrl: normalizeRequiredString(input.baseUrl, "Base URL"),
      apiKey: normalizeRequiredString(input.apiKey, "API Key"),
      testRunId: normalizeRequiredString(input.testRunId, "Test run ID"),
      models,
    });
  }
}

export const providerManager = new ProviderManager();
