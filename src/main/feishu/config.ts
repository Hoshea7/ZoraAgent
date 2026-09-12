import { getDataFilePath } from "../data-paths";
import { readFile } from "node:fs/promises";
import type { FeishuConfig } from "../../shared/types/feishu";
import { isRecord } from "../utils/guards";
import { ensureZoraDir, replaceFileAtomically, isEnoentError } from "../utils/fs";
import { readSecret, storeSecret } from "../utils/secret-storage";
import { normalizeRequiredString, normalizeOptionalString, normalizeBoolean } from "../utils/validate";

const FEISHU_CONFIG_FILE = getDataFilePath("feishu.json");

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
  return storeSecret(plain);
}

export function decryptSecret(encrypted: string): string {
  return readSecret(encrypted);
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
