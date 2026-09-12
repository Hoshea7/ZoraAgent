import path from "node:path";
import { ZORA_DIR } from "./utils/fs";

/** Persistent files owned by Zora; the keys also identify their pre-v2 locations. */
export const DATA_FILE_LOCATIONS = {
  "providers.json": "config/providers.json",
  "default-model-settings.json": "config/default-model-settings.json",
  "mcp.json": "config/mcp.json",
  "memory-settings.json": "config/memory-settings.json",
  "vision-settings.json": "config/vision-settings.json",
  "feishu.json": "config/feishu.json",
  "skill-registry.json": "state/skill-registry.json",
  "feishu-bindings.json": "state/feishu-bindings.json",
  "feishu-dedup.json": "state/feishu-dedup.json",
} as const;

export function getDataFilePath(file: keyof typeof DATA_FILE_LOCATIONS): string {
  return path.join(ZORA_DIR, DATA_FILE_LOCATIONS[file]);
}
