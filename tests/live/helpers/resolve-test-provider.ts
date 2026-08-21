import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderConfig } from "@shared/types/provider";
import { migrateProviderConfigFile } from "@main/provider-config";

export interface TestProviderConfig {
  apiKey: string;
  baseUrl: string;
  model?: string;
  name: string;
  providerType: string;
}

function writeInfo(message: string) {
  process.stdout.write(`${message}\n`);
}

function writeWarning(message: string) {
  process.stderr.write(`${message}\n`);
}

function isLiveProviderRequired() {
  const value = process.env.ZORA_REQUIRE_LIVE_PROVIDER?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readLocalProvider(): TestProviderConfig | null {
  const providersPath = join(homedir(), ".zora", "providers.json");

  try {
    const raw = readFileSync(providersPath, "utf8");
    const { file } = migrateProviderConfigFile(JSON.parse(raw) as unknown);
    const providers: ProviderConfig[] = file.providers;

    if (!Array.isArray(providers) || providers.length === 0) {
      return null;
    }

    const provider =
      providers.find((item) => item.enabled) ??
      providers[0];

    const apiKey = normalizeOptionalString(provider?.apiKey);
    const baseUrl = normalizeOptionalString(provider?.baseUrl);
    const name = normalizeOptionalString(provider?.name);
    const providerType = normalizeOptionalString(provider?.providerType);

    if (!provider || !apiKey || !baseUrl || !name || !providerType) {
      return null;
    }

    return {
      apiKey,
      baseUrl,
      model: provider.models.find((model) => model.enabled)?.id,
      name,
      providerType,
    };
  } catch {
    return null;
  }
}

function readEnvProvider(): TestProviderConfig | null {
  const envConfig = process.env.ZORA_TEST_PROVIDER_CONFIG;
  if (!envConfig) {
    return null;
  }

  try {
    const parsed = JSON.parse(envConfig) as Record<string, unknown>;
    const apiKey = normalizeOptionalString(parsed.apiKey);

    if (!apiKey) {
      return null;
    }

    return {
      apiKey,
      baseUrl:
        normalizeOptionalString(parsed.baseUrl) ?? "https://api.anthropic.com",
      model: normalizeOptionalString(parsed.model),
      name: normalizeOptionalString(parsed.name) ?? "ci-env-provider",
      providerType: normalizeOptionalString(parsed.providerType) ?? "anthropic",
    };
  } catch {
    writeWarning(
      "\x1b[33m⚠ ZORA_TEST_PROVIDER_CONFIG JSON 解析失败\x1b[0m"
    );
    return null;
  }
}

export function resolveTestProvider(): TestProviderConfig | null {
  const local = readLocalProvider();
  if (local) {
    writeInfo(
      `\x1b[36mℹ Live 测试使用本机 Provider: ${local.name} (${local.model || "default model"})\x1b[0m`
    );
    return local;
  }

  const env = readEnvProvider();
  if (env) {
    writeInfo(
      `\x1b[36mℹ Live 测试使用环境变量 Provider: ${env.name} (${env.model || "default model"})\x1b[0m`
    );
    return env;
  }

  writeWarning(
    "\x1b[33m⚠ 未找到可用 Provider。\x1b[0m"
  );
  writeWarning(
    "\x1b[33m  本机: 请先在 ZoraAgent 中配置至少一个 Provider (~/.zora/providers.json)\x1b[0m"
  );
  writeWarning(
    "\x1b[33m  CI:   设置 ZORA_TEST_PROVIDER_CONFIG 环境变量\x1b[0m"
  );

  if (isLiveProviderRequired()) {
    throw new Error(
      "Live Provider is required for this run. Configure ~/.zora/providers.json or ZORA_TEST_PROVIDER_CONFIG."
    );
  }

  return null;
}
