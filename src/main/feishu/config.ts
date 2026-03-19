import path from "node:path";
import { readFile } from "node:fs/promises";
import { safeStorage } from "electron";
import type { FeishuConfig } from "../../shared/types/feishu";
import { isRecord } from "../utils/guards";
import { ZORA_DIR, ensureZoraDir, replaceFileAtomically, isEnoentError } from "../utils/fs";
import { normalizeRequiredString, normalizeOptionalString, normalizeBoolean } from "../utils/validate";

const FEISHU_CONFIG_FILE = path.join(ZORA_DIR, "feishu.json");

function normalizeFeishuConfig(input: unknown): FeishuConfig {
  if (!isRecord(input)) {
    throw new Error("A valid feishu config payload is required.");
  }

  return {
    enabled: normalizeBoolean(input.enabled, "feishu.enabled"),
    appId: normalizeRequiredString(input.appId, "feishu.appId"),
    appSecret: normalizeRequiredString(input.appSecret, "feishu.appSecret"),
    autoStart: normalizeBoolean(input.autoStart, "feishu.autoStart"),
    defaultWorkspaceId: normalizeOptionalString(input.defaultWorkspaceId) ?? undefined,
  };
}

export function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage encryption is unavailable on this device.");
  }

  return safeStorage.encryptString(plain).toString("base64");
}

export function decryptSecret(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage decryption is unavailable on this device.");
  }

  return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
}

export async function loadFeishuConfig(): Promise<FeishuConfig | null> {
  try {
    const raw = await readFile(FEISHU_CONFIG_FILE, "utf8");
    const storedConfig = normalizeFeishuConfig(JSON.parse(raw) as unknown);

    return {
      ...storedConfig,
      appSecret: decryptSecret(storedConfig.appSecret),
    };
  } catch (error) {
    if (isEnoentError(error)) {
      return null;
    }

    throw error;
  }
}

export async function saveFeishuConfig(config: FeishuConfig): Promise<FeishuConfig> {
  const normalizedConfig = normalizeFeishuConfig(config);
  const encryptedConfig: FeishuConfig = {
    ...normalizedConfig,
    appSecret: encryptSecret(normalizedConfig.appSecret),
  };

  await ensureZoraDir();
  await replaceFileAtomically(
    FEISHU_CONFIG_FILE,
    `${JSON.stringify(encryptedConfig, null, 2)}\n`
  );

  return normalizedConfig;
}
