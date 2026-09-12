import { existsSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import type { SkillMeta } from "../shared/types/skill";
import { getErrorMessage, logSystemEvent } from "./system-log";
import { ZORA_DIR } from "./utils/fs";

export type { SkillMeta };

export const ZORA_HOME = ZORA_DIR;
export const GLOBAL_SKILLS_DIR = join(ZORA_HOME, "skills");

const PLUGIN_MANIFEST_DIR = join(ZORA_HOME, ".claude-plugin");
const PLUGIN_MANIFEST_PATH = join(PLUGIN_MANIFEST_DIR, "plugin.json");
const PLUGIN_MANIFEST_CONTENT = `${JSON.stringify(
  {
    name: "zora-skills",
    version: "1.0.0"
  },
  null,
  2
)}\n`;

export function hasErrorCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

function normalizeScalarValue(value: string) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function normalizeDescriptionBlock(lines: string[]) {
  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];

  for (const line of lines) {
    const trimmed = normalizeScalarValue(line);

    if (!trimmed) {
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph.join(" "));
        currentParagraph = [];
      }
      continue;
    }

    currentParagraph.push(trimmed);
  }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(" "));
  }

  return paragraphs.join("\n\n").trim();
}

export function parseSkillFrontmatter(content: string): Pick<SkillMeta, "name" | "description"> | null {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatterMatch) {
    return null;
  }

  const lines = frontmatterMatch[1].split(/\r?\n/);
  let name: string | null = null;
  let description: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const fieldMatch = lines[index].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!fieldMatch) {
      continue;
    }

    const [, fieldName, rawValue] = fieldMatch;
    const normalizedValue = normalizeScalarValue(rawValue);

    if (fieldName === "name") {
      name = normalizedValue;
      continue;
    }

    if (fieldName !== "description") {
      continue;
    }

    if (/^[>|][+-]?$/.test(normalizedValue)) {
      const descriptionLines: string[] = [];

      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];

        if (/^[A-Za-z][\w-]*:\s*/.test(nextLine)) {
          break;
        }

        descriptionLines.push(nextLine.trim());
        index += 1;
      }

      description = normalizeDescriptionBlock(descriptionLines);
      continue;
    }

    description = normalizedValue;
  }

  if (!name || !description) {
    return null;
  }

  return { name, description };
}

export function getBundledSkillsDir(): string | null {
  if (app.isPackaged) {
    const resourcePath = join(process.resourcesPath, "skills");
    if (existsSync(resourcePath)) {
      return resourcePath;
    }

    const appPath = join(app.getAppPath(), "skills");
    if (existsSync(appPath)) {
      return appPath;
    }
  }

  const devPath = join(__dirname, "..", "..", "skills");
  if (existsSync(devPath)) {
    return devPath;
  }

  logSystemEvent(
    "skill",
    "manager",
    "bundled:missing",
    "未找到内置技能目录",
    undefined,
    { level: "warn" }
  );
  return null;
}

export function getZoraPluginPath() {
  return ZORA_HOME;
}

export async function listSkills(): Promise<SkillMeta[]> {
  let entries;

  try {
    entries = await readdir(GLOBAL_SKILLS_DIR, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }

  const skills: Array<SkillMeta & { fileTime: number }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const skillDir = join(GLOBAL_SKILLS_DIR, entry.name);
    const skillFilePath = join(skillDir, "SKILL.md");

    try {
      const content = await readFile(skillFilePath, "utf8");
      const parsed = parseSkillFrontmatter(content);

      if (!parsed) {
        continue;
      }

      // Match Finder ordering by using the skill entry's own modified time.
      // `lstat` preserves symlink metadata instead of following the target.
      const skillEntryStats = await lstat(skillDir);
      const fileTime = Number.isFinite(skillEntryStats.mtimeMs) ? skillEntryStats.mtimeMs : 0;

      skills.push({
        ...parsed,
        dirName: entry.name,
        path: skillDir,
        fileTime
      });
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        continue;
      }

      logSystemEvent("skill", "manager", "load:skip", "技能暂时无法读取", { skill: entry.name, error: getErrorMessage(error) }, { level: "warn" });
    }
  }

  return skills
    .sort((left, right) => {
      if (left.fileTime !== right.fileTime) {
        return right.fileTime - left.fileTime;
      }

      return left.name.localeCompare(right.name);
    })
    .map(({ fileTime: _fileTime, ...skill }) => skill);
}

export async function uninstallSkill(dirName: string): Promise<void> {
  const skillPath = join(GLOBAL_SKILLS_DIR, dirName);

  if (!(await pathExists(skillPath))) {
    throw new Error(`Skill "${dirName}" not found`);
  }

  const lstats = await lstat(skillPath);
  if (lstats.isSymbolicLink()) {
    await unlink(skillPath);
  } else {
    await rm(skillPath, { recursive: true, force: true });
  }
}

async function ensurePluginManifest() {
  if (await pathExists(PLUGIN_MANIFEST_PATH)) {
    return;
  }

  await mkdir(PLUGIN_MANIFEST_DIR, { recursive: true });
  await writeFile(PLUGIN_MANIFEST_PATH, PLUGIN_MANIFEST_CONTENT, "utf8");
}

async function seedAvailableBundledSkills() {
  await mkdir(GLOBAL_SKILLS_DIR, { recursive: true });

  const bundledSkillsDir = getBundledSkillsDir();
  if (!bundledSkillsDir) {
    await ensurePluginManifest();
    return;
  }

  const entries = await readdir(bundledSkillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillName = entry.name;
    try {
      const sourceDir = join(bundledSkillsDir, skillName);
      const sourceSkillFile = join(sourceDir, "SKILL.md");

      if (!(await pathExists(sourceSkillFile))) {
        continue;
      }

      const targetDir = join(GLOBAL_SKILLS_DIR, skillName);
      let occupied = true;
      try { await lstat(targetDir); }
      catch (error) { if (hasErrorCode(error, "ENOENT")) occupied = false; else throw error; }
      if (occupied) {
        logSystemEvent(
          "skill",
          "manager",
          "seed:skip",
          "技能已存在，跳过初始化",
          { skill: skillName }
        );
        continue;
      }

      await cp(sourceDir, targetDir, { recursive: true });
      logSystemEvent(
        "skill",
        "manager",
        "seed",
        "已初始化内置技能",
        { skill: skillName }
      );
    } catch (error) {
      logSystemEvent("skill", "manager", "seed:skip", "技能初始化暂时不可用", { skill: skillName, error: getErrorMessage(error) }, { level: "warn" });
    }
  }

  await ensurePluginManifest();
}

export async function seedBundledSkills(): Promise<void> {
  try { await seedAvailableBundledSkills(); }
  catch (error) {
    logSystemEvent("skill", "manager", "seed:error", "技能初始化暂时不可用", { error: getErrorMessage(error) }, { level: "warn" });
  }
}
