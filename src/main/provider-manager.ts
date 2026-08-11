import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Model } from "@earendil-works/pi-ai";
import type {
  ProviderConfig,
  ProviderCreateInput,
  ProviderProtocol,
  ProviderTestRoleKey,
  ProviderTestResult,
  ProviderTestResultWithRoles,
  ProviderType,
  ProviderUpdateInput,
  RoleModels,
  RoleTestDetail,
} from "../shared/types/provider";
import {
  getDefaultProviderPreset,
  isProviderPresetId,
  PROVIDER_PRESETS,
  resolveProviderPreset,
} from "../shared/provider-presets";
import { resolveProviderProtocol } from "../shared/provider-protocol";
import { getPackagedSafeWorkingDirectory, getSDKRuntimeOptions } from "./sdk-runtime";
import { getErrorMessage, logSystemEvent, startSystemOperation } from "./system-log";
import { replaceFileAtomically, ZORA_DIR } from "./utils/fs";
import { readSecret, storeSecret } from "./utils/secret-storage";

const MASKED_API_KEY = "••••••";
const PROVIDERS_FILE = path.join(ZORA_DIR, "providers.json");
const TEST_CONNECTION_TIMEOUT_MS = 30_000;
const OFFICIAL_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const PROVIDER_TYPES = new Set<ProviderType>([
  "anthropic",
  "volcengine",
  "zhipu",
  "moonshot",
  "deepseek",
  "openai",
  "custom",
]);

type StringRecord = Record<string, string>;
type JsonRecord = Record<string, unknown>;

const PROVIDER_TEST_PROMPT =
  "This is a provider connectivity check. Reply with exactly OK. Do not use tools, browse, or ask follow-up questions.";

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

function stripLegacyProviderFields(provider: ProviderConfig): ProviderConfig {
  const protocol = resolveProviderProtocol(provider);
  const preset = resolveProviderPreset({ ...provider, protocol });
  const sanitized: ProviderConfig = {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    presetId: preset.id,
    protocol,
    enabled: provider.enabled,
    isDefault: provider.isDefault,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };

  if (provider.modelId !== undefined) {
    sanitized.modelId = provider.modelId;
  }

  if (provider.roleModels) {
    sanitized.roleModels = { ...provider.roleModels };
  }
  if (provider.contextWindow !== undefined) {
    sanitized.contextWindow = normalizeOptionalContextWindow(provider.contextWindow);
  }

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

function getResultErrorMessage(message: SDKMessage): string | null {
  if (message.type !== "result" || message.is_error !== true) {
    return null;
  }

  if (message.subtype === "success") {
    const resultText =
      typeof message.result === "string" ? normalizeOptionalString(message.result) : undefined;
    return resultText ?? "连接失败 (success)";
  }

  if (Array.isArray(message.errors) && message.errors.length > 0) {
    return message.errors.join(" | ");
  }

  return `连接失败 (${message.subtype})`;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function extractAssistantText(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .map((block) => {
      if (!isRecord(block)) {
        return "";
      }

      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isRecoverableProviderTestResultError(message: SDKMessage): boolean {
  if (message.type !== "result" || message.subtype === "success") {
    return false;
  }

  if (typeof message.subtype === "string" && /max[_-]?turns/i.test(message.subtype)) {
    return true;
  }

  if (!Array.isArray(message.errors)) {
    return false;
  }

  return message.errors.some(
    (item) => typeof item === "string" && /max[_\s-]?turns/i.test(item)
  );
}

function normalizeProviderTestReply(text: string): string {
  return text.replace(/\s+/g, "").trim().toLowerCase();
}

function isExpectedProviderTestReply(text: string): boolean {
  return normalizeProviderTestReply(text) === "ok";
}

function extractProviderTestTextDelta(message: SDKMessage): string {
  if (message.type === "assistant") {
    return extractAssistantText(message.message);
  }

  if (message.type !== "stream_event" || !isRecord(message.event)) {
    return "";
  }

  if (message.event.type !== "content_block_delta" || !isRecord(message.event.delta)) {
    return "";
  }

  return message.event.delta.type === "text_delta" &&
    typeof message.event.delta.text === "string"
    ? message.event.delta.text
    : "";
}

function stringifyError(error: unknown): string {
  return getErrorMessage(error);
}

function mergeRoleModels(
  existing: RoleModels | undefined,
  patch: RoleModels | undefined,
  patchProvided: boolean
): RoleModels | undefined {
  if (!patchProvided) {
    return existing;
  }

  if (patch === undefined) {
    return undefined;
  }

  return patch;
}

export function buildProviderSdkEnv({
  apiKey,
  baseUrl,
  modelId,
  roleModels,
  baseEnv = process.env,
}: {
  apiKey: string;
  baseUrl: string;
  modelId?: string;
  roleModels?: RoleModels;
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

  // --- 角色模型映射 ---
  const fallbackModel = normalizedModelId;

  const roleEnvMapping: Array<[keyof RoleModels, string]> = [
    ["smallFastModel", "ANTHROPIC_SMALL_FAST_MODEL"],
    ["sonnetModel", "ANTHROPIC_DEFAULT_SONNET_MODEL"],
    ["opusModel", "ANTHROPIC_DEFAULT_OPUS_MODEL"],
    ["haikuModel", "ANTHROPIC_DEFAULT_HAIKU_MODEL"],
  ];

  for (const [roleKey, envVar] of roleEnvMapping) {
    const roleModelId = normalizeOptionalString(roleModels?.[roleKey]);
    const effectiveModelId = roleModelId ?? fallbackModel;
    delete env[envVar];
    if (effectiveModelId) {
      env[envVar] = effectiveModelId;
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
  private activeTestRuns = new Map<string, AbortController>();

  cancelTestRun(testRunId: string): boolean {
    const normalizedTestRunId = normalizeRequiredString(testRunId, "Test run ID");
    const abortController = this.activeTestRuns.get(normalizedTestRunId);

    if (!abortController) {
      return false;
    }

    logSystemEvent(
      "provider",
      "test",
      "cancel",
      "取消模型连接测试",
      { testRunId: normalizedTestRunId }
    );
    abortController.abort();
    return true;
  }

  private async withCancelableTestRun<T>(
    testRunId: string | undefined,
    executor: (abortSignal?: AbortSignal) => Promise<T>
  ): Promise<T> {
    const normalizedTestRunId = normalizeOptionalString(testRunId);

    if (!normalizedTestRunId) {
      return executor();
    }

    const existingAbortController = this.activeTestRuns.get(normalizedTestRunId);
    if (existingAbortController) {
      existingAbortController.abort();
      this.activeTestRuns.delete(normalizedTestRunId);
    }

    const abortController = new AbortController();
    this.activeTestRuns.set(normalizedTestRunId, abortController);

    try {
      return await executor(abortController.signal);
    } finally {
      if (this.activeTestRuns.get(normalizedTestRunId) === abortController) {
        this.activeTestRuns.delete(normalizedTestRunId);
      }
    }
  }

  private async testUniqueModels(
    baseUrl: string,
    apiKey: string,
    uniqueModelIds: string[],
    protocol: ProviderProtocol,
    abortSignal?: AbortSignal
  ): Promise<Map<string, ProviderTestResult>> {
    const settledResults = await Promise.allSettled(
      uniqueModelIds.map(async (uniqueModelId) => {
        const result = await this.performTestConnection(
          baseUrl,
          apiKey,
          uniqueModelId,
          protocol,
          abortSignal
        );
        return { modelId: uniqueModelId, ...result };
      })
    );

    const resultsByModelId = new Map<string, ProviderTestResult>();

    settledResults.forEach((settled, index) => {
      const uniqueModelId = uniqueModelIds[index];

      if (settled.status === "fulfilled") {
        resultsByModelId.set(uniqueModelId, {
          success: settled.value.success,
          message: settled.value.message,
        });
        return;
      }

      resultsByModelId.set(uniqueModelId, {
        success: false,
        message:
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason),
      });
    });

    logSystemEvent(
      "provider",
      "test-roles",
      "models:result",
      "角色模型连接测试完成",
      {
        models: uniqueModelIds.map((uniqueModelId) => {
          const result = resultsByModelId.get(uniqueModelId);
          return `${uniqueModelId}:${result?.success ? "success" : "failure"}`;
        }),
      }
    );

    return resultsByModelId;
  }

  private buildRoleTestDetails(
    entries: Array<{ role: ProviderTestRoleKey; modelId: string }>,
    resultsByModelId: Map<string, ProviderTestResult>
  ): RoleTestDetail[] {
    return entries.map((entry) => {
      const result = resultsByModelId.get(entry.modelId);
      return {
        role: entry.role,
        modelId: entry.modelId,
        success: result?.success ?? false,
        message: result?.message ?? "未知测试结果",
      };
    });
  }

  private async readProviders(): Promise<ProviderConfig[]> {
    try {
      const raw = await readFile(PROVIDERS_FILE, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed)) {
        throw new Error("Provider config file is malformed.");
      }

      return parsed.map((provider) =>
        stripLegacyProviderFields(provider as ProviderConfig)
      );
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
    const sanitized = providers.map((provider) => stripLegacyProviderFields(provider));
    await replaceFileAtomically(PROVIDERS_FILE, `${JSON.stringify(sanitized, null, 2)}\n`);
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

  private rebalanceDefaultProvider(providers: ProviderConfig[]): ProviderConfig[] {
    if (providers.length === 0) {
      return providers;
    }

    const defaultProvider =
      providers.find((provider) => provider.isDefault && provider.enabled) ??
      providers.find((provider) => provider.enabled) ??
      providers.find((provider) => provider.isDefault) ??
      providers[0];

    return providers.map((provider) => ({
      ...provider,
      isDefault: provider.id === defaultProvider.id,
    }));
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
    const provider: ProviderConfig = {
      id: randomUUID(),
      name: normalizeRequiredString(input.name, "Provider name"),
      providerType: input.providerType,
      baseUrl: normalizeRequiredString(input.baseUrl, "Base URL"),
      apiKey: this.encryptApiKey(normalizeRequiredString(input.apiKey, "API Key")),
      modelId: normalizeOptionalString(input.modelId),
      presetId: preset.id,
      protocol: input.protocol ?? preset.protocol,
      roleModels: input.roleModels,
      contextWindow: normalizeOptionalContextWindow(input.contextWindow),
      enabled: true,
      isDefault: providers.length === 0,
      createdAt: now,
      updatedAt: now,
    };

    const nextProviders = this.rebalanceDefaultProvider([...providers, provider]);
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
    const fallbackPreset = getDefaultProviderPreset(nextProviderType);
    const nextProvider: ProviderConfig = {
      ...currentProvider,
      name:
        input.name !== undefined
          ? normalizeRequiredString(input.name, "Provider name")
          : currentProvider.name,
      providerType: nextProviderType,
      presetId:
        selectedPreset?.id ??
        (nextProviderType !== currentProvider.providerType
          ? fallbackPreset.id
          : currentProvider.presetId ?? resolveProviderPreset(currentProvider).id),
      protocol:
        input.protocol ??
        selectedPreset?.protocol ??
        (nextProviderType !== currentProvider.providerType
          ? fallbackPreset.protocol
          : resolveProviderProtocol(currentProvider)),
      baseUrl:
        input.baseUrl !== undefined
          ? normalizeRequiredString(input.baseUrl, "Base URL")
          : currentProvider.baseUrl,
      modelId:
        input.modelId !== undefined
          ? normalizeOptionalString(input.modelId)
          : currentProvider.modelId,
      roleModels: mergeRoleModels(
        currentProvider.roleModels,
        input.roleModels,
        "roleModels" in input
      ),
      contextWindow:
        input.contextWindow !== undefined
          ? normalizeOptionalContextWindow(input.contextWindow)
          : currentProvider.contextWindow,
      enabled: typeof input.enabled === "boolean" ? input.enabled : currentProvider.enabled,
      updatedAt: Date.now(),
    };

    const nextApiKey = normalizeOptionalString(input.apiKey);
    if (nextApiKey) {
      nextProvider.apiKey = this.encryptApiKey(nextApiKey);
    }

    const nextProviders = [...providers];
    nextProviders[index] = nextProvider;

    const balancedProviders = this.rebalanceDefaultProvider(nextProviders);
    await this.writeProviders(balancedProviders);

    const updatedProvider = balancedProviders.find((provider) => provider.id === providerId);
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

    await this.writeProviders(this.rebalanceDefaultProvider(nextProviders));
  }

  async getDefaultProvider(): Promise<ProviderConfig | null> {
    const providers = await this.readProviders();
    return (
      providers.find((provider) => provider.isDefault) ??
      providers.find((provider) => provider.enabled) ??
      providers[0] ??
      null
    );
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

  async getDefaultProviderWithKey(): Promise<{
    provider: ProviderConfig;
    apiKey: string;
  } | null> {
    const providers = await this.readProviders();
    const provider =
      providers.find((p) => p.isDefault) ??
      providers.find((p) => p.enabled) ??
      providers[0] ??
      null;

    if (!provider) {
      return null;
    }

    const apiKey = this.decryptApiKeyValue(provider.apiKey);
    return { provider, apiKey };
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

  async setDefault(providerId: string): Promise<void> {
    const id = normalizeRequiredString(providerId, "Provider ID");
    const providers = await this.readProviders();

    if (!providers.some((provider) => provider.id === id)) {
      throw new Error("Provider not found.");
    }

    const nextProviders = providers.map((provider) => ({
      ...provider,
      isDefault: provider.id === id,
      updatedAt: provider.id === id ? Date.now() : provider.updatedAt,
    }));

    await this.writeProviders(nextProviders);
  }

  async hasConfigured(): Promise<boolean> {
    const providers = await this.readProviders();
    return providers.some((provider) => provider.enabled);
  }

  async testDefaultConnection(): Promise<ProviderTestResult> {
    const activeProvider = await this.getDefaultProvider();

    if (!activeProvider || !activeProvider.enabled) {
      return {
        success: false,
        message: "当前没有可用的默认模型服务，请先完成模型配置。",
      };
    }

    const decryptedApiKey = await this.decryptApiKey(activeProvider.id);

    if (!decryptedApiKey) {
      return {
        success: false,
        message: "无法读取当前默认模型服务的密钥。",
      };
    }

    logSystemEvent(
      "provider",
      "test",
      "default",
      "测试默认模型连接",
      { provider: activeProvider.name, baseUrl: activeProvider.baseUrl }
    );

    return this.performTestConnection(
      activeProvider.baseUrl,
      decryptedApiKey,
      activeProvider.modelId,
      resolveProviderProtocol(activeProvider)
    );
  }

  async testConnection(
    baseUrl: string,
    apiKey: string,
    modelId?: string,
    testRunId?: string,
    protocol: ProviderProtocol = "anthropic-messages"
  ): Promise<ProviderTestResult> {
    return this.withCancelableTestRun(testRunId, (abortSignal) =>
      this.performTestConnection(baseUrl, apiKey, modelId, protocol, abortSignal)
    );
  }

  private async performTestConnection(
    baseUrl: string,
    apiKey: string,
    modelId?: string,
    protocol: ProviderProtocol = "anthropic-messages",
    abortSignal?: AbortSignal
  ): Promise<ProviderTestResult> {
    const normalizedBaseUrl = normalizeRequiredString(baseUrl, "Base URL");
    const normalizedApiKey = normalizeRequiredString(apiKey, "API Key");
    const normalizedModelId = normalizeOptionalString(modelId);
    const testTargetLabel = normalizedModelId ?? "(default model)";
    const abortController = new AbortController();
    const prompt = PROVIDER_TEST_PROMPT;
    if (protocol === "openai-completions") {
      return this.performOpenAIConnectionTest(
        normalizedBaseUrl,
        normalizedApiKey,
        normalizedModelId,
        prompt,
        abortSignal
      );
    }
    const sdkRuntime = getSDKRuntimeOptions();
    const queryOptions = {
      cwd: getPackagedSafeWorkingDirectory(),
      pathToClaudeCodeExecutable: sdkRuntime.pathToClaudeCodeExecutable,
      executable: sdkRuntime.executable,
      executableArgs: sdkRuntime.executableArgs,
      maxTurns: 3,
      persistSession: false,
      includePartialMessages: true,
      permissionMode: "bypassPermissions" as const,
      allowDangerouslySkipPermissions: true,
      env: {
        ...buildProviderSdkEnv({
          apiKey: normalizedApiKey,
          baseUrl: normalizedBaseUrl,
          modelId: normalizedModelId,
        }),
        ...sdkRuntime.env,
      },
      abortController,
    };

    const operation = startSystemOperation("provider", "test", {
      model: testTargetLabel,
    });
    const finish = (
      result: ProviderTestResult,
      status: "success" | "failure" | "stopped",
      fields?: Record<string, unknown>
    ): ProviderTestResult => {
      operation.end(
        status,
        "模型连接测试结束",
        { message: result.message, ...fields },
        { level: status === "failure" ? "warn" : "info" }
      );
      return result;
    };

    operation.log("pre", "start", "开始测试模型连接", {
      baseUrl: normalizedBaseUrl,
      prompt,
    });

    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const response = query({
      prompt,
      options: queryOptions,
    });
    const handleExternalAbort = () => {
      operation.log("runtime", "abort", "收到外部停止信号");
      abortController.abort();
      response.close();
    };

    if (abortSignal?.aborted) {
      handleExternalAbort();
    } else if (abortSignal) {
      abortSignal.addEventListener("abort", handleExternalAbort, { once: true });
    }

    let timedOut = false;
    let sawSuccessResult = false;
    let sawExpectedReply = false;
    let streamedAssistantText = "";

    const timeoutId = setTimeout(() => {
      timedOut = true;
      operation.log(
        "runtime",
        "timeout",
        "模型连接测试超时，停止 SDK 请求",
        { timeoutMs: TEST_CONNECTION_TIMEOUT_MS },
        { level: "warn" }
      );
      abortController.abort();
      response?.close();
    }, TEST_CONNECTION_TIMEOUT_MS);

    try {
      for await (const message of response) {
        const textDelta = extractProviderTestTextDelta(message);
        if (textDelta.length > 0) {
          if (message.type === "assistant") {
            if (isExpectedProviderTestReply(textDelta)) {
              sawExpectedReply = true;
            }
          } else {
            streamedAssistantText += textDelta;
            if (isExpectedProviderTestReply(streamedAssistantText)) {
              sawExpectedReply = true;
            }
          }
        }

        const resultErrorMessage = getResultErrorMessage(message);

        if (resultErrorMessage) {
          if (sawExpectedReply && isRecoverableProviderTestResultError(message)) {
            operation.log(
              "runtime",
              "sdk:recoverable-result",
              "已收到 OK，忽略可恢复的 SDK 终态错误",
              { reason: resultErrorMessage },
              { level: "warn" }
            );
            sawSuccessResult = true;
            continue;
          }

          return finish(
            {
              success: false,
              message: resultErrorMessage,
            },
            "failure",
            { reason: "sdk-result" }
          );
        }

        if (
          message.type === "result" &&
          message.subtype === "success" &&
          message.is_error !== true
        ) {
          sawSuccessResult = true;
        }
      }

      if (sawExpectedReply || sawSuccessResult) {
        if (!sawSuccessResult) {
          operation.log(
            "runtime",
            "reply:ok",
            "已收到 OK 回复，按连接成功处理"
          );
        }

        return finish({
          success: true,
          message: "连接成功",
        }, "success");
      }

      if (!sawSuccessResult) {
        return finish(
          {
            success: false,
            message: "未收到测试结果，请检查 Provider 配置后重试。",
          },
          "failure",
          { reason: "missing-result" }
        );
      }

      return finish({
        success: true,
        message: "连接成功",
      }, "success");
    } catch (error) {
      operation.log(
        "runtime",
        "sdk:error",
        "SDK 请求异常",
        { error: getErrorMessage(error) },
        { level: "error" }
      );

      if (abortSignal?.aborted && !timedOut) {
        return finish({
          success: false,
          message: "测试已停止",
        }, "stopped");
      }

      if (sawSuccessResult) {
        operation.log(
          "runtime",
          "sdk:error:ignored",
          "已收到成功结果，忽略后续 SDK 异常",
          { error: getErrorMessage(error) },
          { level: "warn" }
        );
        return finish({
          success: true,
          message: "连接成功",
        }, "success");
      }

      return finish(
        {
          success: false,
          message: timedOut ? "连接超时，请检查网络或 Provider 配置。" : stringifyError(error),
        },
        "failure",
        { reason: timedOut ? "timeout" : getErrorMessage(error) }
      );
    } finally {
      if (abortSignal) {
        abortSignal.removeEventListener("abort", handleExternalAbort);
      }
      clearTimeout(timeoutId);
      response.close();
    }
  }

  private async performOpenAIConnectionTest(
    baseUrl: string,
    apiKey: string,
    modelId: string | undefined,
    prompt: string,
    abortSignal?: AbortSignal
  ): Promise<ProviderTestResult> {
    if (!modelId) {
      return {
        success: false,
        message: "OpenAI 协议连接测试需要填写模型 ID。",
      };
    }

    const operation = startSystemOperation("provider", "test", {
      model: modelId,
      protocol: "openai-completions",
    });
    const controller = new AbortController();
    const handleExternalAbort = () => controller.abort();
    if (abortSignal?.aborted) {
      controller.abort();
    } else {
      abortSignal?.addEventListener("abort", handleExternalAbort, { once: true });
    }
    const timeoutId = setTimeout(() => controller.abort(), TEST_CONNECTION_TIMEOUT_MS);

    operation.log("pre", "start", "开始测试模型连接", {
      baseUrl,
      protocol: "openai-completions",
    });

    try {
      const { streamSimple } = await import(
        "@earendil-works/pi-ai/api/openai-completions"
      );
      const model: Model<"openai-completions"> = {
        id: modelId,
        name: modelId,
        api: "openai-completions",
        provider: "zora-provider-test",
        baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 64,
      };
      const stream = streamSimple(
        model,
        {
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        },
        {
          apiKey,
          signal: controller.signal,
          maxTokens: 16,
        }
      );
      const result = await stream.result();
      if (result.stopReason === "error" || result.stopReason === "aborted") {
        throw new Error(result.errorMessage ?? "连接测试失败。");
      }

      operation.end("success", "模型连接测试结束", {
        protocol: "openai-completions",
      });
      return { success: true, message: "连接成功" };
    } catch (error) {
      const message = controller.signal.aborted
        ? "连接测试已停止或超时。"
        : getErrorMessage(error);
      operation.end(
        controller.signal.aborted ? "stopped" : "failure",
        "模型连接测试结束",
        { message },
        { level: controller.signal.aborted ? "info" : "warn" }
      );
      return { success: false, message };
    } finally {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", handleExternalAbort);
    }
  }

  private collectConfiguredRoleEntries(
    modelId?: string,
    roleModels?: RoleModels
  ): Array<{ role: ProviderTestRoleKey; label: string; modelId: string }> {
    const normalizedModelId = normalizeOptionalString(modelId);
    const allEntries: Array<{
      role: ProviderTestRoleKey;
      label: string;
      modelId: string | undefined;
    }> = [
      { role: "main", label: "默认模型", modelId: normalizedModelId },
      {
        role: "sonnet",
        label: "探索与搜索",
        modelId: normalizeOptionalString(roleModels?.sonnetModel),
      },
      {
        role: "opus",
        label: "规划与深度思考",
        modelId: normalizeOptionalString(roleModels?.opusModel),
      },
      {
        role: "haiku",
        label: "快速响应",
        modelId: normalizeOptionalString(roleModels?.haikuModel),
      },
      {
        role: "small",
        label: "摘要压缩",
        modelId: normalizeOptionalString(roleModels?.smallFastModel),
      },
    ];

    const validEntries = allEntries.filter(
      (entry): entry is {
        role: ProviderTestRoleKey;
        label: string;
        modelId: string;
      } => entry.modelId !== undefined
    );

    return validEntries;
  }

  async testConnectionWithRoleModels(
    baseUrl: string,
    apiKey: string,
    modelId?: string,
    roleModels?: RoleModels,
    testRunId?: string,
    protocol: ProviderProtocol = "anthropic-messages"
  ): Promise<ProviderTestResultWithRoles> {
    return this.withCancelableTestRun(testRunId, (abortSignal) =>
      this.performTestConnectionWithRoleModels(
        baseUrl,
        apiKey,
        modelId,
        roleModels,
        protocol,
        abortSignal
      )
    );
  }

  private async performTestConnectionWithRoleModels(
    baseUrl: string,
    apiKey: string,
    modelId?: string,
    roleModels?: RoleModels,
    protocol: ProviderProtocol = "anthropic-messages",
    abortSignal?: AbortSignal
  ): Promise<ProviderTestResultWithRoles> {
    const entries = this.collectConfiguredRoleEntries(modelId, roleModels);

    if (entries.length === 0) {
      return {
        success: false,
        message: "未配置任何模型，请至少填写一个模型 ID。",
        details: [],
      };
    }

    const uniqueModelIds = Array.from(new Set(entries.map((entry) => entry.modelId)));

    logSystemEvent(
      "provider",
      "test-roles",
      "start",
      "开始测试角色模型连接",
      {
        models: entries.map((entry) => `${entry.label}:${entry.modelId}`),
        uniqueModels: uniqueModelIds.length,
      }
    );

    const resultsByModelId = await this.testUniqueModels(
      baseUrl,
      apiKey,
      uniqueModelIds,
      protocol,
      abortSignal
    );
    const details = this.buildRoleTestDetails(entries, resultsByModelId);

    const allSuccess = details.every((detail) => detail.success);
    const failCount = Array.from(resultsByModelId.values()).filter((detail) => !detail.success)
      .length;
    const successCount = uniqueModelIds.length - failCount;

    logSystemEvent(
      "provider",
      "test-roles",
      "summary",
      "角色模型连接测试结束",
      { success: successCount, failure: failCount },
      { level: failCount > 0 ? "warn" : "info" }
    );

    return {
      success: allSuccess,
      message: allSuccess
        ? `共测试 ${uniqueModelIds.length} 个模型，全部连接成功`
        : `${failCount} / ${uniqueModelIds.length} 个模型连接失败`,
      details,
    };
  }
}

export const providerManager = new ProviderManager();
