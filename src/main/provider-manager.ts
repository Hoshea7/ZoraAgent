import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename as fsRename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  ProviderConfig,
  ProviderCreateInput,
  ProviderTestRoleKey,
  ProviderTestResult,
  ProviderTestResultWithRoles,
  ProviderType,
  ProviderUpdateInput,
  RoleModels,
  RoleTestDetail,
} from "../shared/types/provider";
import { getPackagedSafeWorkingDirectory, getSDKRuntimeOptions } from "./sdk-runtime";
import { readSecret, storeSecret } from "./utils/secret-storage";

const MASKED_API_KEY = "••••••";
const ZORA_DIR = path.join(homedir(), ".zora");
const PROVIDERS_FILE = path.join(ZORA_DIR, "providers.json");
const TEST_CONNECTION_TIMEOUT_MS = 30_000;
const OFFICIAL_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const PROVIDER_TYPES = new Set<ProviderType>([
  "anthropic",
  "volcengine",
  "zhipu",
  "moonshot",
  "deepseek",
  "custom",
]);

type StringRecord = Record<string, string>;
type JsonRecord = Record<string, unknown>;

const PROVIDER_TEST_PROMPT =
  "This is a provider connectivity check. Reply with exactly OK. Do not use tools, browse, or ask follow-up questions.";

async function replaceFileAtomically(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, "utf8");

  try {
    await fsRename(tmpPath, filePath);
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code: string }).code
        : "";

    if (code === "EEXIST" || code === "EPERM") {
      try {
        await unlink(filePath);
      } catch {
        // Ignore missing destination file.
      }

      await fsRename(tmpPath, filePath);
      return;
    }

    try {
      await unlink(tmpPath);
    } catch {
      // Ignore temp cleanup failures.
    }

    throw error;
  }
}

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

function isProviderType(value: unknown): value is ProviderType {
  return typeof value === "string" && PROVIDER_TYPES.has(value as ProviderType);
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
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : String(error);
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
  private async testUniqueModels(
    baseUrl: string,
    apiKey: string,
    uniqueModelIds: string[]
  ): Promise<Map<string, ProviderTestResult>> {
    const settledResults = await Promise.allSettled(
      uniqueModelIds.map(async (uniqueModelId) => {
        const result = await this.testConnection(baseUrl, apiKey, uniqueModelId);
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

    console.log(
      "[provider:test-roles] Unique model results:",
      uniqueModelIds.map((uniqueModelId) => {
        const result = resultsByModelId.get(uniqueModelId);
        return `${uniqueModelId} => ${result?.success ? "success" : `failure (${result?.message ?? "未知错误"})`}`;
      })
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

      return parsed as ProviderConfig[];
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
    await mkdir(ZORA_DIR, { recursive: true });
    await replaceFileAtomically(PROVIDERS_FILE, `${JSON.stringify(providers, null, 2)}\n`);
  }

  private encryptApiKey(plainKey: string): string {
    return storeSecret(plainKey);
  }

  private decryptApiKeyValue(encryptedKey: string): string {
    return readSecret(encryptedKey, {
      allowLegacyUnprefixedSafeStorage: true,
    });
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

    const providers = await this.readProviders();
    const now = Date.now();
    const provider: ProviderConfig = {
      id: randomUUID(),
      name: normalizeRequiredString(input.name, "Provider name"),
      providerType: input.providerType,
      baseUrl: normalizeRequiredString(input.baseUrl, "Base URL"),
      apiKey: this.encryptApiKey(normalizeRequiredString(input.apiKey, "API Key")),
      modelId: normalizeOptionalString(input.modelId),
      roleModels: input.roleModels,
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

    const currentProvider = providers[index];
    const nextProvider: ProviderConfig = {
      ...currentProvider,
      name:
        input.name !== undefined
          ? normalizeRequiredString(input.name, "Provider name")
          : currentProvider.name,
      providerType: input.providerType ?? currentProvider.providerType,
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
        message: "当前没有可用的默认 Provider，请先完成模型配置。",
      };
    }

    const decryptedApiKey = await this.decryptApiKey(activeProvider.id);

    if (!decryptedApiKey) {
      return {
        success: false,
        message: "无法读取当前默认 Provider 的 API Key。",
      };
    }

    console.log("[provider:test-default] Testing:", activeProvider.name, activeProvider.baseUrl);

    return this.testConnection(
      activeProvider.baseUrl,
      decryptedApiKey,
      activeProvider.modelId
    );
  }

  async testConnection(
    baseUrl: string,
    apiKey: string,
    modelId?: string
  ): Promise<ProviderTestResult> {
    const normalizedBaseUrl = normalizeRequiredString(baseUrl, "Base URL");
    const normalizedApiKey = normalizeRequiredString(apiKey, "API Key");
    const normalizedModelId = normalizeOptionalString(modelId);
    const testTargetLabel = normalizedModelId ?? "(default model)";
    const abortController = new AbortController();
    const prompt = PROVIDER_TEST_PROMPT;
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

    console.log(`[provider:test][${testTargetLabel}] Starting connection test.`, {
      baseUrl: normalizedBaseUrl,
      modelId: testTargetLabel,
      prompt,
    });

    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const response = query({
      prompt,
      options: queryOptions,
    });

    let timedOut = false;
    let sawSuccessResult = false;
    let sawExpectedReply = false;
    let streamedAssistantText = "";

    const timeoutId = setTimeout(() => {
      timedOut = true;
      console.warn(
        `[provider:test] Timed out after ${TEST_CONNECTION_TIMEOUT_MS}ms. Aborting query.`
      );
      abortController.abort();
      response.close();
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
            console.warn(
              `[provider:test][${testTargetLabel}] Ignoring recoverable terminal SDK result after expected OK reply:`,
              resultErrorMessage
            );
            sawSuccessResult = true;
            continue;
          }

          console.warn(
            `[provider:test][${testTargetLabel}] Test failed from SDK result:`,
            resultErrorMessage
          );
          return {
            success: false,
            message: resultErrorMessage,
          };
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
          console.log(
            `[provider:test][${testTargetLabel}] Treating explicit OK reply as a successful connectivity check without final result.`
          );
        }

        console.log(`[provider:test][${testTargetLabel}] Test succeeded.`);
        return {
          success: true,
          message: "连接成功",
        };
      }

      if (!sawSuccessResult) {
        console.warn(
          `[provider:test][${testTargetLabel}] Stream completed without a success result message.`
        );
        return {
          success: false,
          message: "未收到测试结果，请检查 Provider 配置后重试。",
        };
      }

      console.log(`[provider:test][${testTargetLabel}] Test completed successfully.`);
      return {
        success: true,
        message: "连接成功",
      };
    } catch (error) {
      console.error(`[provider:test][${testTargetLabel}] Query threw an error:`, error);

      if (sawSuccessResult) {
        console.warn(
          `[provider:test][${testTargetLabel}] Treating thrown error after explicit success result as success.`
        );
        console.log(`[provider:test][${testTargetLabel}] Test succeeded.`);
        return {
          success: true,
          message: "连接成功",
        };
      }

      console.warn(
        `[provider:test][${testTargetLabel}] Test failed from thrown error:`,
        timedOut ? "连接超时，请检查网络或 Provider 配置。" : stringifyError(error)
      );
      return {
        success: false,
        message: timedOut ? "连接超时，请检查网络或 Provider 配置。" : stringifyError(error),
      };
    } finally {
      clearTimeout(timeoutId);
      response.close();
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
      { role: "main", label: "主模型", modelId: normalizedModelId },
      {
        role: "sonnet",
        label: "Sonnet",
        modelId: normalizeOptionalString(roleModels?.sonnetModel),
      },
      {
        role: "opus",
        label: "Opus",
        modelId: normalizeOptionalString(roleModels?.opusModel),
      },
      {
        role: "haiku",
        label: "Haiku",
        modelId: normalizeOptionalString(roleModels?.haikuModel),
      },
      {
        role: "small",
        label: "Small",
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
    roleModels?: RoleModels
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

    console.log(
      `[provider:test-roles] Testing ${uniqueModelIds.length} unique model(s):`,
      entries.map((entry) => `${entry.label} → ${entry.modelId}`)
    );

    const resultsByModelId = await this.testUniqueModels(baseUrl, apiKey, uniqueModelIds);
    const details = this.buildRoleTestDetails(entries, resultsByModelId);

    const allSuccess = details.every((detail) => detail.success);
    const failCount = Array.from(resultsByModelId.values()).filter((detail) => !detail.success)
      .length;
    const successCount = uniqueModelIds.length - failCount;

    console.log(
      `[provider:test-roles] Completed role-model test: ${successCount} succeeded, ${failCount} failed.`
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
