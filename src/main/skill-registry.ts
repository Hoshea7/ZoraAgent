import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillRegistryData, SkillRegistryEntry } from "../shared/types/skill";
import { ZORA_HOME, hasErrorCode } from "./skill-manager";

const REGISTRY_PATH = join(ZORA_HOME, "skill-registry.json");

export async function readRegistry(): Promise<SkillRegistryData> {
  try {
    const content = await readFile(REGISTRY_PATH, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      console.warn("[skill-registry] Failed to read registry, falling back to empty state:", error);
    }
    return { version: 1, skills: {} };
  }
}

async function writeRegistry(data: SkillRegistryData): Promise<void> {
  await writeFile(REGISTRY_PATH, JSON.stringify(data, null, 2), "utf8");
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
