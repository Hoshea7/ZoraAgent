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
import { app, safeStorage } from "electron";
import type {
  ProviderConfig,
  ProviderCreateInput,
  ProviderTestResult,
  ProviderType,
  ProviderUpdateInput,
} from "../shared/types/provider";
import { resolveSDKCliPath } from "./agent";

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
  if (message.type !== "result" || message.subtype === "success") {
    return null;
  }

  if (Array.isArray(message.errors) && message.errors.length > 0) {
    return message.errors.join(" | ");
  }

  return `连接失败 (${message.subtype})`;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : String(error);
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

  return env;
}

export class ProviderManager {
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
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage encryption is unavailable on this device.");
    }

    return safeStorage.encryptString(plainKey).toString("base64");
  }

  private decryptApiKeyValue(encryptedKey: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage decryption is unavailable on this device.");
    }

    return safeStorage.decryptString(Buffer.from(encryptedKey, "base64"));
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
    const abortController = new AbortController();
    const prompt = "hi";
    const queryOptions = {
      cwd: app.getAppPath(),
      pathToClaudeCodeExecutable: resolveSDKCliPath(),
      executable: "node" as const,
      executableArgs: [] as string[],
      maxTurns: 1,
      persistSession: false,
      includePartialMessages: false,
      permissionMode: "bypassPermissions" as const,
      allowDangerouslySkipPermissions: true,
      env: buildProviderSdkEnv({
        apiKey: normalizedApiKey,
        baseUrl: normalizedBaseUrl,
        modelId: normalizedModelId,
      }),
      abortController,
    };

    console.log("[provider:test] Starting connection test.", {
      baseUrl: normalizedBaseUrl,
      modelId: normalizedModelId ?? "(default model)",
      prompt,
    });

    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const response = query({
      prompt,
      options: queryOptions,
    });

    let timedOut = false;
    let sawSuccessResult = false;

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
        const resultErrorMessage = getResultErrorMessage(message);

        if (resultErrorMessage) {
          console.warn("[provider:test] Test failed from SDK result:", resultErrorMessage);
          return {
            success: false,
            message: resultErrorMessage,
          };
        }

        if (message.type === "result" && message.subtype === "success") {
          sawSuccessResult = true;
        }
      }

      if (!sawSuccessResult) {
        console.warn("[provider:test] Stream completed without a success result message.");
        return {
          success: false,
          message: "未收到测试结果，请检查 Provider 配置后重试。",
        };
      }

      console.log("[provider:test] Test completed successfully.");
      return {
        success: true,
        message: "连接成功",
      };
    } catch (error) {
      console.error("[provider:test] Query threw an error:", error);
      return {
        success: false,
        message: timedOut ? "连接超时，请检查网络或 Provider 配置。" : stringifyError(error),
      };
    } finally {
      clearTimeout(timeoutId);
      response.close();
    }
  }
}

export const providerManager = new ProviderManager();
