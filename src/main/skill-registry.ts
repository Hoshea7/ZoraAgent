import { getDataFilePath } from "./data-paths";
import { readFile } from "node:fs/promises";
import { replaceFileAtomically } from "./utils/fs";
import type { SkillRegistryData, SkillRegistryEntry } from "../shared/types/skill";
import { hasErrorCode } from "./skill-manager";
import { getErrorMessage, logSystemEvent } from "./system-log";

const REGISTRY_PATH = getDataFilePath("skill-registry.json");

export async function readRegistry(): Promise<SkillRegistryData> {
  try {
    const content = await readFile(REGISTRY_PATH, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      logSystemEvent(
        "skill",
        "registry",
        "read:error",
        "读取技能注册表失败，使用空状态",
        { error: getErrorMessage(error) },
        { level: "warn" }
      );
    }
    return { version: 1, skills: {} };
  }
}

async function writeRegistry(data: SkillRegistryData): Promise<void> {
  await replaceFileAtomically(REGISTRY_PATH, JSON.stringify(data, null, 2));
}

export async function updateRegistryEntry(
  dirName: string,
  entry: SkillRegistryEntry
): Promise<void> {
  const registry = await readRegistry();
  registry.skills[dirName] = entry;
  await writeRegistry(registry);
}

export async function removeRegistryEntry(dirName: string): Promise<void> {
  const registry = await readRegistry();
  delete registry.skills[dirName];
  await writeRegistry(registry);
}

export async function getRegistryEntry(
  dirName: string
): Promise<SkillRegistryEntry | null> {
  const registry = await readRegistry();
  return registry.skills[dirName] ?? null;
}
