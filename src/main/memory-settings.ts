import { getDataFilePath } from "./data-paths";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_MEMORY_SETTINGS,
  type MemorySettings,
} from "../shared/types/memory";
import { logSystemEvent } from "./system-log";
import { isRecord } from "./utils/guards";

const SETTINGS_PATH = getDataFilePath("memory-settings.json");
const VALID_BATCH_IDLE_MINUTES = new Set([1, 10, 20, 30, 60, 120]);

let cached: MemorySettings | null = null;

function normalizeMemorySettings(value: unknown): MemorySettings {
  if (!isRecord(value)) {
    return { ...DEFAULT_MEMORY_SETTINGS };
  }

  const enabled =
    typeof value.enabled === "boolean"
      ? value.enabled
      : DEFAULT_MEMORY_SETTINGS.enabled;

  const mode =
    value.mode === "immediate" || value.mode === "batch" || value.mode === "manual"
      ? value.mode
      : DEFAULT_MEMORY_SETTINGS.mode;

  const batchIdleMinutes =
    typeof value.batchIdleMinutes === "number" &&
    Number.isInteger(value.batchIdleMinutes) &&
    VALID_BATCH_IDLE_MINUTES.has(value.batchIdleMinutes)
      ? value.batchIdleMinutes
      : DEFAULT_MEMORY_SETTINGS.batchIdleMinutes;

  const memoryProviderId =
    value.memoryProviderId === null
      ? null
      : typeof value.memoryProviderId === "string" &&
          value.memoryProviderId.trim().length > 0
        ? value.memoryProviderId.trim()
        : DEFAULT_MEMORY_SETTINGS.memoryProviderId;

  const memoryModelId =
    value.memoryModelId === null
      ? null
      : typeof value.memoryModelId === "string" && value.memoryModelId.trim().length > 0
        ? value.memoryModelId.trim()
        : DEFAULT_MEMORY_SETTINGS.memoryModelId;

  return {
    enabled,
    mode,
    batchIdleMinutes,
    memoryProviderId,
    memoryModelId: memoryProviderId ? memoryModelId : null,
  };
}

async function readPersistedMemorySettings(): Promise<MemorySettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    return normalizeMemorySettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_MEMORY_SETTINGS };
  }
}

function logMemoryEnabledChange(
  previous: MemorySettings,
  next: MemorySettings
): void {
  if (previous.enabled === next.enabled) {
    return;
  }

  logSystemEvent(
    "app",
    "memory",
    "settings:enabled",
    next.enabled ? "记忆已开启" : "记忆已关闭",
    {
      previousEnabled: previous.enabled,
      enabled: next.enabled,
      mode: next.mode,
    }
  );
}

function areMemorySettingsEqual(
  left: MemorySettings,
  right: MemorySettings
): boolean {
  return (
    left.enabled === right.enabled &&
    left.mode === right.mode &&
    left.batchIdleMinutes === right.batchIdleMinutes &&
    left.memoryProviderId === right.memoryProviderId &&
    left.memoryModelId === right.memoryModelId
  );
}

export async function loadMemorySettings(): Promise<MemorySettings> {
  if (cached) {
    return { ...cached };
  }

  cached = await readPersistedMemorySettings();

  return { ...cached };
}

export async function saveMemorySettings(
  settings: MemorySettings
): Promise<MemorySettings> {
  const previous = cached ?? (await readPersistedMemorySettings());
  const normalized = normalizeMemorySettings(settings);

  if (cached && areMemorySettingsEqual(cached, normalized)) {
    return { ...cached };
  }

  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(normalized, null, 2), "utf8");
  cached = normalized;
  logMemoryEnabledChange(previous, normalized);
  return { ...cached };
}

/**
 * 同步获取已缓存的 settings。
 * 若 cache 尚未通过 loadMemorySettings() 初始化，则返回默认值。
 */
export function getMemorySettingsSync(): MemorySettings {
  return cached ?? { ...DEFAULT_MEMORY_SETTINGS };
}
