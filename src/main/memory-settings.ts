import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  DEFAULT_MEMORY_SETTINGS,
  type MemorySettings,
} from "../shared/types/memory";

const SETTINGS_PATH = path.join(homedir(), ".zora", "memory-settings.json");
const VALID_BATCH_IDLE_MINUTES = new Set([1, 10, 20, 30, 60, 120]);

let cached: MemorySettings | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeMemorySettings(value: unknown): MemorySettings {
  if (!isRecord(value)) {
    return { ...DEFAULT_MEMORY_SETTINGS };
  }

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

  return {
    mode,
    batchIdleMinutes,
    memoryProviderId,
  };
}

export async function loadMemorySettings(): Promise<MemorySettings> {
  if (cached) {
    return { ...cached };
  }

  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    cached = normalizeMemorySettings(JSON.parse(raw));
  } catch {
    cached = { ...DEFAULT_MEMORY_SETTINGS };
  }

  return { ...cached };
}

export async function saveMemorySettings(settings: MemorySettings): Promise<void> {
  const normalized = normalizeMemorySettings(settings);
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(normalized, null, 2), "utf8");
  cached = normalized;
}

/**
 * 同步获取已缓存的 settings。
 * 若 cache 尚未通过 loadMemorySettings() 初始化，则返回默认值。
 */
export function getMemorySettingsSync(): MemorySettings {
  return cached ?? { ...DEFAULT_MEMORY_SETTINGS };
}
