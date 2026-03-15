import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_ZORA_ID, getZoraDirPath, isBootstrapped, loadFile, loadRecentLogs } from "./memory-store";
import { getBundledSkillsDir } from "./skill-manager";

type ZoraSystemPrompt = {
  type: "preset";
  preset: "claude_code";
  append: string;
};

const MEMORY_INSTRUCTIONS = `## Memory Instructions

Your memory files live in ~/.zora/zoras/default/. You can read and write them freely using file tools (Read, Write, Edit).

You wake up blank each session — these files are your continuity.
"Text > Brain": if you want to remember something, write it to a file. There are no mental notes.

When to write:
- User says "remember this" → append to memory/YYYY-MM-DD.md (today's daily log)
- Important decisions, preferences, long-term knowledge → update MEMORY.md
- Lessons learned or mistakes → update SOUL.md's "Lessons Learned" section
- New info about the user → update USER.md

Daily log format (memory/YYYY-MM-DD.md):
### HH:MM
{content}

Don't over-record. Only log what matters: decisions, preferences, key facts, follow-ups.
Casual chat and generic Q&A don't need logging.

Write memory naturally — like a person, only important things are worth remembering.`;

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function buildBootstrapAppend(): Promise<string> {
  const skillsDir = getBundledSkillsDir();
  if (!skillsDir) {
    return "Bootstrap skill files not found. Ask the user to set up their Zora manually.";
  }

  const bootstrapDir = join(skillsDir, "bootstrap");

  const filesToLoad = [
    join(bootstrapDir, "SKILL.md"),
    join(bootstrapDir, "references", "conversation-guide.md"),
    join(bootstrapDir, "templates", "SOUL.template.md"),
    join(bootstrapDir, "templates", "IDENTITY.template.md"),
    join(bootstrapDir, "templates", "USER.template.md")
  ];

  const contents = await Promise.all(filesToLoad.map(readFileIfExists));

  const sections = contents.filter((c): c is string => c !== null);

  if (sections.length === 0) {
    return "Bootstrap skill files not found. Ask the user to set up their Zora manually.";
  }

  const zoraDirPath = getZoraDirPath(DEFAULT_ZORA_ID);
  const pathNote = `\n\n---\n\n**File output path:** Write all generated files to \`${zoraDirPath}/\`. Create the directory with \`mkdir -p ${zoraDirPath}\` if needed.`;

  return sections.join("\n\n---\n\n") + pathNote;
}

async function buildNormalAppend(zoraId: string): Promise<string> {
  const parts: string[] = [];

  const soul = await loadFile("SOUL.md", zoraId);
  if (soul) {
    parts.push(`## Your Soul\n${soul}`);
  }

  const identity = await loadFile("IDENTITY.md", zoraId);
  if (identity) {
    parts.push(`## Your Identity\n${identity}`);
  }

  const user = await loadFile("USER.md", zoraId);
  if (user) {
    parts.push(`## Your Human\n${user}`);
  }

  const memory = await loadFile("MEMORY.md", zoraId);
  if (memory) {
    parts.push(`## Your Long-Term Memory\n${memory}`);
  }

  const recentLogs = await loadRecentLogs(2, zoraId);
  if (recentLogs) {
    parts.push(`## Recent Daily Logs\n${recentLogs}`);
  }

  parts.push(MEMORY_INSTRUCTIONS);

  return parts.join("\n\n");
}

export async function isBootstrapMode(zoraId = DEFAULT_ZORA_ID): Promise<boolean> {
  return !(await isBootstrapped(zoraId));
}

export async function buildZoraSystemPrompt(zoraId = DEFAULT_ZORA_ID): Promise<ZoraSystemPrompt> {
  const bootstrap = await isBootstrapMode(zoraId);

  const append = bootstrap
    ? await buildBootstrapAppend()
    : await buildNormalAppend(zoraId);

  return {
    type: "preset",
    preset: "claude_code",
    append
  };
}
