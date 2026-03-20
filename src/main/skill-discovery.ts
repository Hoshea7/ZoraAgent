/**
 * skill-discovery.ts
 *
 * 扫描外部 AI 工具的 skill 目录，发现可导入的 skill。
 * 支持以 symlink 或 copy 方式导入到 ~/.zora/skills/。
 */

import { cp, lstat, mkdir, readFile, readdir, readlink, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type {
  DiscoveredSkill,
  DiscoveryResult,
  ExternalToolConfig,
  ImportMethod,
  ImportResult,
  ImportSelection,
} from "../shared/types/skill";
import { GLOBAL_SKILLS_DIR } from "./skill-manager";
import { updateRegistryEntry } from "./skill-registry";

// ─── 外部工具配置 ───

const home = homedir();

const EXTERNAL_TOOLS: ExternalToolConfig[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    skillsDirs: [join(home, ".claude", "skills")],
    icon: "claude",
  },
  {
    id: "codex",
    name: "Codex CLI",
    skillsDirs: [join(home, ".codex", "skills")],
    icon: "codex",
  },
  {
    id: "opencode",
    name: "OpenCode",
    skillsDirs: [join(home, ".config", "opencode", "skills")],
    icon: "opencode",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    skillsDirs: [join(home, ".gemini", "skills")],
    icon: "gemini",
  },
  {
    id: "agents-shared",
    name: "Agents (Shared)",
    skillsDirs: [join(home, ".agents", "skills")],
    icon: "agents",
  },
];

// ─── 工具函数 ───

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

/**
 * 解析 SKILL.md frontmatter，提取 name 和 description。
 * 与 skill-manager.ts 中的 parseSkillFrontmatter 逻辑一致。
 */
function parseSkillFrontmatter(
  content: string
): { name: string; description: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;

  const lines = match[1].split(/\r?\n/);
  let name: string | null = null;
  let description: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const fieldMatch = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!fieldMatch) continue;

    const [, fieldName, rawValue] = fieldMatch;
    const value = rawValue.trim().replace(/^["']|["']$/g, "");

    if (fieldName === "name") {
      name = value;
    } else if (fieldName === "description") {
      if (/^[>|][+-]?$/.test(value)) {
        const descLines: string[] = [];
        while (i + 1 < lines.length) {
          const next = lines[i + 1];
          if (/^[A-Za-z][\w-]*:\s*/.test(next)) break;
          descLines.push(next.trim());
          i++;
        }
        description = descLines.filter(Boolean).join(" ").trim();
      } else {
        description = value;
      }
    }
  }

  if (!name || !description) return null;
  return { name, description };
}

// ─── 核心函数 ───

/**
 * 收集已安装的 skill 目录名和 symlink 目标路径，
 * 用于判断外部 skill 是否已存在于 Zora。
 */
async function getInstalledSkillInfo(): Promise<{
  dirNames: Set<string>;
  symlinkTargets: Set<string>;
}> {
  const dirNames = new Set<string>();
  const symlinkTargets = new Set<string>();

  try {
    const entries = await readdir(GLOBAL_SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        dirNames.add(entry.name);
      }
      if (entry.isSymbolicLink()) {
        try {
          const target = await readlink(join(GLOBAL_SKILLS_DIR, entry.name));
          symlinkTargets.add(resolve(GLOBAL_SKILLS_DIR, target));
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      console.warn("[skill-discovery] Failed to read skills dir:", error);
    }
  }

  return { dirNames, symlinkTargets };
}

/**
 * 扫描单个目录下的 skill 子目录。
 */
async function scanSkillsInDir(
  dir: string,
  toolId: string,
  toolName: string,
  installed: { dirNames: Set<string>; symlinkTargets: Set<string> }
): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = join(dir, entry.name);
    const skillFilePath = join(skillDir, "SKILL.md");

    try {
      const content = await readFile(skillFilePath, "utf8");
      const parsed = parseSkillFrontmatter(content);
      if (!parsed) continue;

      const resolvedPath = resolve(skillDir);
      const alreadyInZora =
        installed.dirNames.has(entry.name) ||
        installed.symlinkTargets.has(resolvedPath);

      skills.push({
        name: parsed.name,
        description: parsed.description,
        dirName: entry.name,
        sourcePath: skillDir,
        sourceTool: toolId,
        sourceToolName: toolName,
        alreadyInZora,
      });
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        console.warn(
          `[skill-discovery] Error reading skill at ${skillDir}:`,
          error
        );
      }
    }
  }

  return skills;
}

/**
 * 扫描所有外部工具，返回按工具分组的发现结果。
 * 结构与 DiscoveryResult 类型一致。
 */
export async function discoverExternalSkills(): Promise<DiscoveryResult> {
  const installed = await getInstalledSkillInfo();

  let totalNew = 0;
  const tools: DiscoveryResult["tools"] = [];

  for (const tool of EXTERNAL_TOOLS) {
    let toolExists = false;
    const allSkills: DiscoveredSkill[] = [];

    for (const dir of tool.skillsDirs) {
      if (await pathExists(dir)) {
        toolExists = true;
        const skills = await scanSkillsInDir(
          dir,
          tool.id,
          tool.name,
          installed
        );
        allSkills.push(...skills);
      }
    }

    const newCount = allSkills.filter((skill) => !skill.alreadyInZora).length;
    totalNew += newCount;

    tools.push({
      tool,
      exists: toolExists,
      skills: allSkills.sort((left, right) => left.name.localeCompare(right.name)),
    });
  }

  return { tools, totalNew };
}

/**
 * 将外部 skill 导入到 ~/.zora/skills/。
 */
export async function importSkill(
  sourcePath: string,
  method: ImportMethod,
  sourceTool: string,
  dirName?: string
): Promise<ImportResult> {
  const targetDirName = dirName ?? basename(sourcePath);
  const targetPath = join(GLOBAL_SKILLS_DIR, targetDirName);

  // 安全校验
  if (targetDirName !== basename(targetDirName)) {
    return {
      dirName: targetDirName,
      success: false,
      error: "Invalid directory name: must not contain path separators.",
    };
  }

  if (!(await pathExists(sourcePath))) {
    return {
      dirName: targetDirName,
      success: false,
      error: `Source path does not exist: ${sourcePath}`,
    };
  }

  if (!(await pathExists(join(sourcePath, "SKILL.md")))) {
    return {
      dirName: targetDirName,
      success: false,
      error: `Source does not contain SKILL.md: ${sourcePath}`,
    };
  }

  if (await pathExists(targetPath)) {
    return {
      dirName: targetDirName,
      success: false,
      error: `Skill "${targetDirName}" already exists. Uninstall first to re-import.`,
    };
  }

  await mkdir(GLOBAL_SKILLS_DIR, { recursive: true });

  try {
    if (method === "symlink") {
      await symlink(resolve(sourcePath), targetPath, "dir");
    } else {
      await cp(resolve(sourcePath), targetPath, { recursive: true });
    }
  } catch (error) {
    return {
      dirName: targetDirName,
      success: false,
      error: `Failed to ${method} skill: ${String(error)}`,
    };
  }

  // 写入 registry
  try {
    await updateRegistryEntry(targetDirName, {
      source: {
        type: "imported",
        fromTool: sourceTool,
        method,
        originalPath: resolve(sourcePath),
      },
      installedAt: Date.now(),
    });
  } catch {
    console.warn(
      `[skill-discovery] Registry update failed for ${targetDirName}`
    );
  }

  return { dirName: targetDirName, success: true, method };
}

/**
 * 批量导入。
 */
export async function importSkills(
  selections: ImportSelection[]
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const selection of selections) {
    const result = await importSkill(
      selection.sourcePath,
      selection.method,
      selection.sourceTool,
      selection.dirName
    );
    results.push(result);
  }
  return results;
}

/**
 * 返回外部工具配置列表。
 */
export function listExternalTools(): ExternalToolConfig[] {
  return EXTERNAL_TOOLS;
}
