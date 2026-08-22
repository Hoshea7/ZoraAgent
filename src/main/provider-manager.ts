import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Model } from "@earendil-works/pi-ai";
import type {
  ProviderConfig,
  ProviderCreateInput,
  ProviderModel,
  ProviderProtocol,
  ProviderModelsTestResult,
  ProviderTestResult,
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
import { resolveProviderProtocol } from "../shared/provider-protocol";
import { getPackagedSafeWorkingDirectory, getSDKRuntimeOptions } from "./sdk-runtime";
import { getErrorMessage, logSystemEvent, startSystemOperation } from "./system-log";
import { replaceFileAtomically, ZORA_DIR } from "./utils/fs";
import { readSecret, storeSecret } from "./utils/secret-storage";
import { migrateProviderConfigFile, PROVIDER_CONFIG_VERSION } from "./provider-config";
import { supportsPiDeveloperRole } from "./runtime/pi-provider-registry";

const MASKED_API_KEY = "••••••";
const PROVIDERS_FILE = path.join(ZORA_DIR, "providers.json");
const TEST_CONNECTION_TIMEOUT_MS = 30_000;
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

function normalizeProviderModels(value: unknown): ProviderModel[] {
  if (!Array.isArray(value)) {
    throw new Error("Models are required.");
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("Each model must be an object.");
    const id = normalizeRequiredString(item.id, "Model ID");
    if (seen.has(id)) throw new Error(`Duplicate model ID: ${id}`);
    seen.add(id);
    if (typeof item.enabled !== "boolean") {
      throw new Error(`Model ${id} must declare whether it is enabled.`);
    }
    return {
      id,
      name: normalizeOptionalString(item.name),
      enabled: item.enabled,
      contextWindow: normalizeOptionalContextWindow(item.contextWindow),
      maxTokens: normalizeOptionalContextWindow(item.maxTokens),
    };
  });
}

function sanitizeProvider(provider: ProviderConfig): ProviderConfig {
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
    models: normalizeProviderModels(provider.models),
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

  private async readProviders(): Promise<ProviderConfig[]> {
    try {
      const raw = await readFile(PROVIDERS_FILE, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      const result = migrateProviderConfigFile(parsed);
      if (result.migrated) {
        await replaceFileAtomically(
          PROVIDERS_FILE,
          `${JSON.stringify(result.file, null, 2)}\n`
        );
      }
      return result.file.providers.map(sanitizeProvider);
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
    const models = normalizeProviderModels(input.models);
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
      models:
        input.models !== undefined
          ? normalizeProviderModels(input.models)
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

  async getDefaultProvider(): Promise<ProviderConfig | null> {
    const providers = await this.readProviders();
    return providers.find(
      (provider) => provider.enabled && getEnabledProviderModels(provider).length > 0
    ) ?? null;
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
    const provider = providers.find(
      (item) => item.enabled && getEnabledProviderModels(item).length > 0
    ) ?? null;

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

  async hasConfigured(): Promise<boolean> {
    const providers = await this.readProviders();
    return providers.some(
      (provider) => provider.enabled && getEnabledProviderModels(provider).length > 0
    );
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
      getEnabledProviderModels(activeProvider)[0]?.id,
      resolveProviderProtocol(activeProvider),
      undefined,
      activeProvider.providerType
    );
  }

  async testConnection(
    baseUrl: string,
    apiKey: string,
    modelId?: string,
    testRunId?: string,
    protocol: ProviderProtocol = "anthropic-messages",
    providerType: ProviderType = "custom"
  ): Promise<ProviderTestResult> {
    return this.withCancelableTestRun(testRunId, (abortSignal) =>
      this.performTestConnection(
        baseUrl,
        apiKey,
        modelId,
        protocol,
        abortSignal,
        providerType
      )
    );
  }

  async testModels(
    baseUrl: string,
    apiKey: string,
    modelIds: string[],
    testRunId: string,
    protocol: ProviderProtocol = "anthropic-messages",
    providerType: ProviderType = "custom"
  ): Promise<ProviderModelsTestResult> {
    const normalizedModelIds = Array.from(
      new Set(modelIds.map((modelId) => normalizeRequiredString(modelId, "Model ID")))
    );
    if (normalizedModelIds.length === 0) {
      throw new Error("At least one model ID is required.");
    }

    return this.withCancelableTestRun(testRunId, async (abortSignal) => {
      const results = await Promise.all(
        normalizedModelIds.map(async (modelId) => {
          try {
            return {
              modelId,
              ...(await this.performTestConnection(
                baseUrl,
                apiKey,
                modelId,
                protocol,
                abortSignal,
                providerType
              )),
            };
          } catch (error) {
            return {
              modelId,
              success: false,
              message: getErrorMessage(error),
            };
          }
        })
      );
      return {
        success: results.every((result) => result.success),
        results,
      };
    });
  }

  private async performTestConnection(
    baseUrl: string,
    apiKey: string,
    modelId?: string,
    protocol: ProviderProtocol = "anthropic-messages",
    abortSignal?: AbortSignal,
    providerType: ProviderType = "custom"
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
        abortSignal,
        providerType
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

      }

      if (sawExpectedReply) {
        return finish({
          success: true,
          message: "连接成功",
        }, "success");
      }

      return finish(
        {
          success: false,
          message: "模型已响应，但未返回预期的测试结果。请重试。",
        },
        "failure",
        { reason: "unexpected-reply" }
      );
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

      if (sawExpectedReply) {
        operation.log(
          "runtime",
          "sdk:error:ignored",
          "已收到 OK 回复，忽略后续 SDK 异常",
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
    abortSignal?: AbortSignal,
    providerType: ProviderType = "custom"
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
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 512,
        compat: {
          supportsDeveloperRole: supportsPiDeveloperRole(providerType),
        },
      };
      const stream = streamSimple(
        model,
        {
          systemPrompt:
            "You are Zora. Complete the user's request directly. Tools are available, but this request does not require calling one.",
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
          tools: [
            {
              name: "provider_connectivity_check",
              description: "A no-op tool used to verify tool schema compatibility.",
              parameters: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          ],
        },
        {
          apiKey,
          signal: controller.signal,
          maxTokens: 512,
          reasoning: "high",
        }
      );
      const result = await stream.result();
      if (result.stopReason === "error" || result.stopReason === "aborted") {
        throw new Error(result.errorMessage ?? "连接测试失败。");
      }
      const reply = extractAssistantText(result);
      if (!isExpectedProviderTestReply(reply)) {
        throw new Error("模型已响应，但未返回预期的测试结果。请重试。");
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

}

export const providerManager = new ProviderManager();
