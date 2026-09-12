import { DATA_FILE_LOCATIONS } from "./data-paths";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isEnoentError, replaceFileAtomically, ZORA_DIR } from "./utils/fs";
import { createDirectoryReference, decodeSession, encodeWorkspace, pathSyntax, relativeWithin, resolveRelative } from "./directory-reference";
import type { SessionMeta, WorkspaceMeta } from "../shared/zora";
import type { DirectoryReference } from "../shared/directory-reference";

const VERSION = 2;
const versionFile = path.join(ZORA_DIR, "data-format.json");
const journalFile = path.join(ZORA_DIR, "data-upgrade.json");
type Change = { file: string; before: string | null; after: string | null };
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
  return { version: 1, changes };
}

function parseUpgrade(raw: string): Upgrade {
  const upgrade = JSON.parse(raw) as Upgrade;
  if (![1, 2].includes(upgrade.version) || !Array.isArray(upgrade.changes)) throw new Error("数据升级记录无法读取");
  for (const item of upgrade.changes) {
    const knownFile = typeof item.file === "string" && (
      Object.prototype.hasOwnProperty.call(DATA_FILE_LOCATIONS, item.file)
      || Object.values(DATA_FILE_LOCATIONS).some((file) => file === item.file)
      || item.file === "workspaces.json"
      || /^workspaces\/[^/\\.][^/\\]*\/(workspace\.json|sessions\/index\.json)$/.test(item.file)
    );
    if (!knownFile || !(item.after === null || typeof item.after === "string")
        || !(item.before === null || typeof item.before === "string")) {
      throw new Error("数据升级记录无效");
    }
    resolveRelative(ZORA_DIR, item.file);
  }

  return upgrade;
}

async function buildLayoutUpgrade(): Promise<Upgrade> {
  const changes: Change[] = [];
  for (const [source, target] of Object.entries(DATA_FILE_LOCATIONS)) {
    const before = await optional(path.join(ZORA_DIR, source));
    if (before === null) continue;
    const existing = await optional(path.join(ZORA_DIR, target));
    if (existing !== null && existing !== before) throw new Error(`数据目录存在不同的配置文件：${source} 与 ${target}，请保留两份文件并确认使用哪一份`);
    changes.push({ file: target, before: existing, after: before });
    changes.push({ file: source, before, after: null });
  }
  return { version: 2, changes };
}

async function applyUpgrade(upgrade: Upgrade): Promise<void> {
  if (upgrade.changes.length) {
    const backupFile = path.join(ZORA_DIR, "backups", `directory-format-v${upgrade.version}.json`);
    if (await optional(backupFile) === null) await replaceFileAtomically(backupFile, JSON.stringify(upgrade, null, 2));
    await replaceFileAtomically(journalFile, JSON.stringify(upgrade));
  }
  try {
    for (const item of upgrade.changes) {
      const file = resolveRelative(ZORA_DIR, item.file);
      if (item.after === null) await rm(file, { force: true });
      else await replaceFileAtomically(file, item.after);
    }
    await replaceFileAtomically(versionFile, JSON.stringify({ version: upgrade.version }));
  } catch (error) {
    for (const item of upgrade.changes) {
      const file = resolveRelative(ZORA_DIR, item.file);
      if (item.before === null) await rm(file, { force: true });
      else await replaceFileAtomically(file, item.before);
    }
    throw error;
  }
  await rm(journalFile, { force: true });
}

async function upgradeData(): Promise<void> {
  const versionRaw = await optional(versionFile);
  let version = versionRaw === null ? 0 : JSON.parse(versionRaw).version;
  if (![0, 1, VERSION].includes(version)) throw new Error("此数据格式需要对应版本的 Zora，请保留数据并更新应用");
  const previous = await optional(journalFile);
  let pending = previous === null ? undefined : parseUpgrade(previous);
  if (pending && pending.version <= version) {
    await rm(journalFile, { force: true });
    pending = undefined;
  }
  if (pending && pending.version !== version + 1) throw new Error("数据升级记录与当前版本不一致");
  if (version === VERSION) return;
  await mkdir(ZORA_DIR, { recursive: true });
  if (version === 0) {
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
  }
  while (version < VERSION) {
    const upgrade = pending ?? (version === 0 ? await buildUpgrade() : await buildLayoutUpgrade());
    await applyUpgrade(upgrade);
    version = upgrade.version;
    pending = undefined;
  }
}

export function ensureDataFormat(): Promise<void> {
  ready ??= upgradeData().catch((error) => { ready = undefined; throw error; });
  return ready;
}
