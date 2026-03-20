import { existsSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

export const ZORA_HOME = join(homedir(), ".zora");
export const GLOBAL_SKILLS_DIR = join(ZORA_HOME, "skills");
export const INACTIVE_SKILLS_DIR = join(ZORA_HOME, "skills-inactive");

export interface SkillMeta {
  name: string;
  description: string;
  dirName: string;
  path: string;
}

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

function hasErrorCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function pathExists(filePath: string) {
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

function parseSkillFrontmatter(content: string): Pick<SkillMeta, "name" | "description"> | null {
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

  console.warn("[skill-manager] Could not locate bundled skills directory");
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

  const skills: SkillMeta[] = [];

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

      skills.push({
        ...parsed,
        dirName: entry.name,
        path: skillDir
      });
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        continue;
      }

      throw error;
    }
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
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

export async function toggleSkill(dirName: string, enabled: boolean): Promise<void> {
  await mkdir(INACTIVE_SKILLS_DIR, { recursive: true });

  const srcDir = enabled ? INACTIVE_SKILLS_DIR : GLOBAL_SKILLS_DIR;
  const destDir = enabled ? GLOBAL_SKILLS_DIR : INACTIVE_SKILLS_DIR;

  const srcPath = join(srcDir, dirName);
  const destPath = join(destDir, dirName);

  if (!(await pathExists(srcPath))) {
    throw new Error(
      `Skill "${dirName}" not found in ${enabled ? "inactive" : "active"} directory`
    );
  }

  if (await pathExists(destPath)) {
    throw new Error(
      `Skill "${dirName}" already exists in ${enabled ? "active" : "inactive"} directory`
    );
  }

  await rename(srcPath, destPath);
}

export async function listInactiveSkills(): Promise<SkillMeta[]> {
  let entries;
  try {
    entries = await readdir(INACTIVE_SKILLS_DIR, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }

  const skills: SkillMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillDir = join(INACTIVE_SKILLS_DIR, entry.name);
    const skillFilePath = join(skillDir, "SKILL.md");
    try {
      const content = await readFile(skillFilePath, "utf8");
      const parsed = parseSkillFrontmatter(content);
      if (!parsed) continue;
      skills.push({ ...parsed, dirName: entry.name, path: skillDir });
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) continue;
      throw error;
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function ensurePluginManifest() {
  if (await pathExists(PLUGIN_MANIFEST_PATH)) {
    return;
  }

  await mkdir(PLUGIN_MANIFEST_DIR, { recursive: true });
  await writeFile(PLUGIN_MANIFEST_PATH, PLUGIN_MANIFEST_CONTENT, "utf8");
}

export async function seedBundledSkills() {
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
    const sourceDir = join(bundledSkillsDir, skillName);
    const sourceSkillFile = join(sourceDir, "SKILL.md");

    if (!(await pathExists(sourceSkillFile))) {
      continue;
    }

    const targetDir = join(GLOBAL_SKILLS_DIR, skillName);
    if (await pathExists(targetDir)) {
      console.log(`[skill-manager] Skill already exists, skipping: ${skillName}`);
      continue;
    }

    await cp(sourceDir, targetDir, { recursive: true });
    console.log(`[skill-manager] Seeded bundled skill: ${skillName}`);
  }

  await ensurePluginManifest();
}
