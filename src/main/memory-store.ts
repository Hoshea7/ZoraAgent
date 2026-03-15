import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_ZORA_ID = "default";

const ZORA_DIR_NAME = ".zora";
const ZORAS_DIR_NAME = "zoras";
const MEMORY_DIR_NAME = "memory";
const BOOTSTRAP_FILE_NAME = "SOUL.md";
const IDENTITY_FILE_NAME = "IDENTITY.md";
const USER_FILE_NAME = "USER.md";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_SOUL_CONTENT = `# SOUL.md

**Identity**
Zora is a professional AI assistant. Support the user with clear thinking, strong execution, and dependable follow-through. Help with problem solving, writing, planning, research, coding, and everyday work.

**Core Traits**
Be helpful, accurate, and practical. Stay calm under ambiguity. Explain things clearly without sounding robotic. Be proactive when the next step is obvious, and be honest when something is uncertain or missing.

**Communication**
Default to the user's language. Match the user's tone and pace. Prefer concise, high-signal responses, but expand when the task needs more detail. Keep the style warm, competent, and easy to work with.

**Autonomy**
Handle straightforward tasks directly. When a choice has important tradeoffs, hidden risk, or could define long-term preferences, pause and confirm before proceeding.

**Growth**
Learn the user's preferences, workflows, and priorities over time through real collaboration. Improve through use, but do not invent history or personal details that were never established.

**Lessons Learned**
- This Zora was created from the default assistant scaffold after bootstrap was skipped.
`;

const DEFAULT_IDENTITY_CONTENT = `# IDENTITY.md

**Name:** Zora
**Species:** Zora
**Creature Type:** AI professional assistant
**Vibe:** Clear, reliable, capable
**Emoji:** Not set
`;

const DEFAULT_USER_CONTENT = `# USER.md

> This Zora started from the default assistant profile. Fill this in gradually through conversation.

**Name:** Unknown
**Address as:** the user
**Timezone:** Unknown
**Role & Context:** Not configured yet.
**Notes:** Learn the user's preferences and working style through real interactions, then update this file with durable context.
`;

function hasErrorCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isEnoentError(error: unknown) {
  return hasErrorCode(error, "ENOENT");
}

function isRenameReplaceError(error: unknown) {
  return (
    hasErrorCode(error, "EEXIST") ||
    hasErrorCode(error, "EPERM") ||
    hasErrorCode(error, "ENOTEMPTY")
  );
}

function assertSafeFileName(fileName: string) {
  if (fileName.trim().length === 0 || path.basename(fileName) !== fileName) {
    throw new Error(`Invalid zora file name: ${fileName}`);
  }
}

function assertIsoDate(date: string) {
  if (!ISO_DATE_PATTERN.test(date)) {
    throw new Error(`Invalid ISO date: ${date}`);
  }
}

function getIsoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getTimeLabel(date = new Date()) {
  return date.toTimeString().slice(0, 5);
}

function getDateWithOffset(daysOffset: number, now = new Date()) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + daysOffset);
  return getIsoDate(date);
}

function resolveZoraFilePath(fileName: string, zoraId = DEFAULT_ZORA_ID) {
  assertSafeFileName(fileName);
  return path.join(getZoraDirPath(zoraId), fileName);
}

function resolveDailyLogPath(date: string, zoraId = DEFAULT_ZORA_ID) {
  assertIsoDate(date);
  return path.join(getZoraMemoryDirPath(zoraId), `${date}.md`);
}

async function readUtf8File(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isEnoentError(error)) {
      return null;
    }

    throw error;
  }
}

async function pathExistsAsFile(filePath: string) {
  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile();
  } catch (error) {
    if (isEnoentError(error)) {
      return false;
    }

    throw error;
  }
}

async function replaceFileAtomically(filePath: string, content: string) {
  const tempPath = `${filePath}.tmp`;

  await writeFile(tempPath, content, "utf8");

  try {
    await rename(tempPath, filePath);
  } catch (error) {
    if (isRenameReplaceError(error)) {
      try {
        await unlink(filePath);
      } catch (unlinkError) {
        if (!isEnoentError(unlinkError)) {
          throw unlinkError;
        }
      }

      await rename(tempPath, filePath);
      return;
    }

    try {
      await unlink(tempPath);
    } catch (cleanupError) {
      if (!isEnoentError(cleanupError)) {
        throw cleanupError;
      }
    }

    throw error;
  }
}

export function getZoraDirPath(zoraId = DEFAULT_ZORA_ID) {
  return path.join(homedir(), ZORA_DIR_NAME, ZORAS_DIR_NAME, zoraId);
}

export function getZoraMemoryDirPath(zoraId = DEFAULT_ZORA_ID) {
  return path.join(getZoraDirPath(zoraId), MEMORY_DIR_NAME);
}

export async function ensureZoraDir(zoraId = DEFAULT_ZORA_ID) {
  const zoraDirPath = getZoraDirPath(zoraId);
  const memoryDirPath = getZoraMemoryDirPath(zoraId);

  await mkdir(zoraDirPath, { recursive: true });
  await mkdir(memoryDirPath, { recursive: true });
}

export async function loadFile(fileName: string, zoraId = DEFAULT_ZORA_ID) {
  return readUtf8File(resolveZoraFilePath(fileName, zoraId));
}

export async function saveFile(
  fileName: string,
  content: string,
  zoraId = DEFAULT_ZORA_ID
) {
  await ensureZoraDir(zoraId);
  await replaceFileAtomically(resolveZoraFilePath(fileName, zoraId), content);
}

export async function hasFile(fileName: string, zoraId = DEFAULT_ZORA_ID) {
  return pathExistsAsFile(resolveZoraFilePath(fileName, zoraId));
}

export async function isBootstrapped(zoraId = DEFAULT_ZORA_ID) {
  return hasFile(BOOTSTRAP_FILE_NAME, zoraId);
}

async function ensureDefaultFileContent(
  fileName: string,
  defaultContent: string,
  zoraId = DEFAULT_ZORA_ID
) {
  const existingContent = await loadFile(fileName, zoraId);
  if (existingContent !== null && existingContent.trim().length > 0) {
    return false;
  }

  await saveFile(fileName, defaultContent, zoraId);
  return true;
}

export async function ensureBootstrapScaffold(zoraId = DEFAULT_ZORA_ID) {
  const createdFiles: string[] = [];

  if (await ensureDefaultFileContent(BOOTSTRAP_FILE_NAME, DEFAULT_SOUL_CONTENT, zoraId)) {
    createdFiles.push(BOOTSTRAP_FILE_NAME);
  }

  if (await ensureDefaultFileContent(IDENTITY_FILE_NAME, DEFAULT_IDENTITY_CONTENT, zoraId)) {
    createdFiles.push(IDENTITY_FILE_NAME);
  }

  if (await ensureDefaultFileContent(USER_FILE_NAME, DEFAULT_USER_CONTENT, zoraId)) {
    createdFiles.push(USER_FILE_NAME);
  }

  return createdFiles;
}

export async function listFiles(zoraId = DEFAULT_ZORA_ID) {
  try {
    const entries = await readdir(getZoraDirPath(zoraId), { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isEnoentError(error)) {
      return [];
    }

    throw error;
  }
}

export async function appendDailyLog(text: string, zoraId = DEFAULT_ZORA_ID) {
  const now = new Date();
  const today = getIsoDate(now);
  const entry = `### ${getTimeLabel(now)}\n${text}\n\n`;

  await ensureZoraDir(zoraId);
  await appendFile(resolveDailyLogPath(today, zoraId), entry, "utf8");
}

export async function loadDailyLog(date: string, zoraId = DEFAULT_ZORA_ID) {
  return readUtf8File(resolveDailyLogPath(date, zoraId));
}

export async function loadRecentLogs(days: number, zoraId = DEFAULT_ZORA_ID) {
  const totalDays = Math.max(0, Math.floor(days));

  if (totalDays === 0) {
    return null;
  }

  const dates = Array.from({ length: totalDays }, (_, index) =>
    getDateWithOffset(index - totalDays + 1)
  );
  const logs = await Promise.all(
    dates.map(async (date) => ({
      date,
      content: await loadDailyLog(date, zoraId)
    }))
  );
  const sections = logs
    .filter((log): log is { date: string; content: string } => log.content !== null)
    .map((log) => `## ${log.date}\n${log.content.trimEnd()}`);

  return sections.length > 0 ? sections.join("\n\n") : null;
}

export const memoryStore = {
  DEFAULT_ZORA_ID,
  getZoraDirPath,
  getZoraMemoryDirPath,
  ensureZoraDir,
  loadFile,
  saveFile,
  hasFile,
  isBootstrapped,
  ensureBootstrapScaffold,
  listFiles,
  appendDailyLog,
  loadDailyLog,
  loadRecentLogs
};
