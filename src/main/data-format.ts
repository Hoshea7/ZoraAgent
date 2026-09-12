import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isEnoentError, replaceFileAtomically, ZORA_DIR } from "./utils/fs";
import { createDirectoryReference, decodeSession, encodeWorkspace, pathSyntax, relativeWithin, resolveRelative } from "./directory-reference";
import type { SessionMeta, WorkspaceMeta } from "../shared/zora";
import type { DirectoryReference } from "../shared/directory-reference";

const VERSION = 1;
const versionFile = path.join(ZORA_DIR, "data-format.json");
const journalFile = path.join(ZORA_DIR, "data-upgrade.json");
const backupFile = path.join(ZORA_DIR, "backups", "directory-format-v1.json");
type Change = { file: string; before: string | null; after: string };
type Upgrade = { version: number; changes: Change[] };
let ready: Promise<void> | undefined;

async function optional(file: string): Promise<string | null> {
  try { return await readFile(file, "utf8"); }
  catch (error) { if (isEnoentError(error)) return null; throw error; }
}

/** Only infer an old root from the exact default workspace layout. */
export function sourceDataRoot(directory: unknown): string | undefined {
  if (typeof directory !== "string") return undefined;
  const syntax = pathSyntax(directory);
  if (!syntax.isAbsolute(directory)) return undefined;
  const root = syntax.resolve(directory, "..", "..", "..");
  return relativeWithin(root, directory) === "workspaces/default/files" ? root : undefined;
}

export function upgradeSessionDirectory(session: SessionMeta, workspaceId: string, projectRoot: string | undefined, oldRoot: string | undefined): DirectoryReference {
  if (session.directory) {
    decodeSession(session as Parameters<typeof decodeSession>[0], ZORA_DIR, projectRoot);
    return session.directory;
  }
  const directory = session.workingDirectory?.trim();
  if (directory) {
    const syntax = pathSyntax(directory);
    const ownerId = session.workingDirectoryOwnerSessionId ?? session.id;
    const ownedRoot = workspaceId === "default" && syntax.basename(directory) === ownerId
      ? sourceDataRoot(syntax.dirname(directory)) : undefined;
    return createDirectoryReference(directory, ownedRoot ?? oldRoot ?? ZORA_DIR, workspaceId === "default" ? undefined : projectRoot);
  }
  if (workspaceId !== "default") return { kind: "project", path: "" };
  // Older default sessions ran in the source user's home, not in managed files.
  if (oldRoot && pathSyntax(oldRoot).basename(oldRoot) === ".zora") {
    return { kind: "external", path: pathSyntax(oldRoot).dirname(oldRoot) };
  }
  return { kind: "unbound" };
}

async function buildUpgrade(): Promise<Upgrade> {
  const changes: Change[] = [];
  const workspaces = new Map<string, WorkspaceMeta>();
  const workspaceFile = await optional(path.join(ZORA_DIR, "workspaces.json"));
  let workspaceIndex: WorkspaceMeta[] | undefined;
  if (workspaceFile !== null) {
    try {
      const parsed = JSON.parse(workspaceFile);
      if (Array.isArray(parsed)) {
        workspaceIndex = parsed;
        for (const item of parsed) if (item && typeof item.id === "string") workspaces.set(item.id, item);
      }
    } catch { /* Existing workspace recovery retains malformed indexes. */ }
  }
  let entries: string[] = [];
  try { entries = (await readdir(path.join(ZORA_DIR, "workspaces"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); }
  catch (error) { if (!isEnoentError(error)) throw error; }
  const ids = new Set<string>([...workspaces.keys(), ...entries]);
  const sidecars = new Map<string, { file: string; raw: string; value: WorkspaceMeta }>();
  for (const id of ids) {
    if (id === "." || id === ".." || /[\\/]/.test(id)) throw new Error("工作区标识无效");
    const file = `workspaces/${id}/workspace.json`;
    const raw = await optional(path.join(ZORA_DIR, file));
    if (raw === null) continue;
    try {
      const value = JSON.parse(raw);
      if (value?.id === id) {
        sidecars.set(id, { file, raw, value });
        if (!workspaces.has(id)) workspaces.set(id, value);
      }
    } catch { /* Workspace recovery owns invalid sidecars. */ }
  }
  const oldRoot = sourceDataRoot(workspaces.get("default")?.path);
  for (const id of ids) {
    const file = `workspaces/${id}/sessions/index.json`;
    const raw = await optional(path.join(ZORA_DIR, file));
    if (raw === null) continue;
    const sessions: SessionMeta[] = JSON.parse(raw);
    if (!Array.isArray(sessions) || sessions.some((s) => !s || typeof s.id !== "string")) throw new Error(`会话索引无法升级：${id}`);
    const converted = sessions.map((session) => {
      const directory = upgradeSessionDirectory(session, id, workspaces.get(id)?.path, oldRoot);
      const { workingDirectory: _legacy, ...rest } = session;
      return { ...rest, directory };
    });
    changes.push({ file, before: raw, after: JSON.stringify(converted, null, 2) });
  }
  if (workspaceIndex && workspaceFile !== null) {
    changes.push({ file: "workspaces.json", before: workspaceFile, after: JSON.stringify(workspaceIndex.map((w) => w?.id === "default" ? encodeWorkspace(w) : w), null, 2) });
  }
  for (const { file, raw, value } of sidecars.values()) {
    if (value.id === "default") changes.push({ file, before: raw, after: JSON.stringify(encodeWorkspace(value), null, 2) });
  }
  return { version: VERSION, changes };
}

function parseUpgrade(raw: string): Upgrade {
  const upgrade = JSON.parse(raw) as Upgrade;
  if (upgrade.version !== VERSION || !Array.isArray(upgrade.changes)) throw new Error("数据升级记录无法读取");
  for (const item of upgrade.changes) {
    if (typeof item.file !== "string" || !(item.file === "workspaces.json" || /^workspaces\/[^/\\.][^/\\]*\/(workspace\.json|sessions\/index\.json)$/.test(item.file)) || typeof item.after !== "string" || !(item.before === null || typeof item.before === "string")) throw new Error("数据升级记录无效");
    resolveRelative(ZORA_DIR, item.file);
  }
  return upgrade;
}

async function upgradeData(): Promise<void> {
  const versionRaw = await optional(versionFile);
  if (versionRaw !== null) {
    const version = JSON.parse(versionRaw).version;
    if (version !== VERSION) throw new Error("此数据格式需要对应版本的 Zora，请保留数据并更新应用");
    // The version marker is committed last, so a leftover journal is already applied.
    await rm(journalFile, { force: true });
    return;
  }
  await mkdir(ZORA_DIR, { recursive: true });
  // Carry the original pre-workspace layout into the same format upgrade.
  const legacy = path.join(ZORA_DIR, "sessions");
  const current = path.join(ZORA_DIR, "workspaces", "default", "sessions");
  try {
    if ((await stat(legacy)).isDirectory()) {
      try { await stat(current); }
      catch (error) {
        if (!isEnoentError(error)) throw error;
        await mkdir(path.dirname(current), { recursive: true });
        await rename(legacy, current);
      }
    }
  } catch (error) { if (!isEnoentError(error)) throw error; }
  const previous = await optional(journalFile);
  const upgrade = previous === null ? await buildUpgrade() : parseUpgrade(previous);
  if (upgrade.changes.length) {
    await mkdir(path.dirname(backupFile), { recursive: true });
    if (await optional(backupFile) === null) await replaceFileAtomically(backupFile, JSON.stringify(upgrade, null, 2));
    await replaceFileAtomically(journalFile, JSON.stringify(upgrade));
  }
  try {
    for (const item of upgrade.changes) await replaceFileAtomically(resolveRelative(ZORA_DIR, item.file), item.after);
    await replaceFileAtomically(versionFile, JSON.stringify({ version: VERSION }));
  } catch (error) {
    // Keep the journal for retry, restore the old format before returning the error.
    for (const item of upgrade.changes) {
      if (item.before === null) await rm(resolveRelative(ZORA_DIR, item.file), { force: true });
      else await replaceFileAtomically(resolveRelative(ZORA_DIR, item.file), item.before);
    }
    throw error;
  }
  await rm(journalFile, { force: true });
}

export function ensureDataFormat(): Promise<void> {
  ready ??= upgradeData().catch((error) => { ready = undefined; throw error; });
  return ready;
}
