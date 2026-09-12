import { isDeepStrictEqual } from "node:util";
import { ensureDataFormat } from "./data-format";
import { decodeSession, encodeSession, decodeWorkspace, encodeWorkspace, type StoredSession, resolveRelative } from "./directory-reference";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import type { WorkspaceMeta, SessionMeta } from "../shared/zora";
import { getErrorMessage, logSystemEvent } from "./system-log";
import { requireDirectory, rebindDirectory } from "./project-directory";
import { rebindWorkspaceExclusively, setWorkspaceRecoveryPending, useWorkspace } from "./workspace-operation";
import { PROJECT_DIRECTORY_BUSY } from "../shared/project-directory";
import { isEnoentError, replaceFileAtomically, ZORA_DIR } from "./utils/fs";

export const DEFAULT_WORKSPACE_ID = "default";
const WORKSPACES_FILE = path.join(ZORA_DIR, "workspaces.json");
const WORKSPACE_DATA_ROOT = path.join(ZORA_DIR, "workspaces");
const WORKSPACE_SIDECAR_FILE = "workspace.json";
const SESSIONS_INDEX_FILE = path.join("sessions", "index.json");

type WorkspaceFileReadResult = {
  workspaces: WorkspaceMeta[];
  shouldRewrite: boolean;
};

function createDefaultWorkspace(
  existing?: Partial<WorkspaceMeta>
): WorkspaceMeta {
  const now = new Date().toISOString();

  return {
    id: DEFAULT_WORKSPACE_ID,
    name: "默认工作区",
    path: getWorkspaceFilesDir(DEFAULT_WORKSPACE_ID),
    createdAt: existing?.createdAt ?? now,
    updatedAt: existing?.updatedAt ?? existing?.createdAt ?? now,
  };
}

function isWorkspaceMeta(value: unknown): value is WorkspaceMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WorkspaceMeta).id === "string" &&
    typeof (value as WorkspaceMeta).name === "string" &&
    typeof (value as WorkspaceMeta).path === "string" &&
    typeof (value as WorkspaceMeta).createdAt === "string" &&
    typeof (value as WorkspaceMeta).updatedAt === "string"
  );
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeWorkspaces(workspaces: WorkspaceMeta[]): WorkspaceMeta[] {
  const defaultWorkspace = workspaces.find(
    (workspace) => workspace.id === DEFAULT_WORKSPACE_ID
  );
  const seenIds = new Set<string>([DEFAULT_WORKSPACE_ID]);
  const others: WorkspaceMeta[] = [];

  for (const workspace of workspaces) {
    if (
      workspace.id === DEFAULT_WORKSPACE_ID ||
      workspace.id.trim().length === 0 ||
      workspace.name.trim().length === 0 ||
      seenIds.has(workspace.id)
    ) {
      continue;
    }

    seenIds.add(workspace.id);
    others.push(workspace);
  }

  return [createDefaultWorkspace(defaultWorkspace), ...others];
}

async function ensureZoraDir(): Promise<void> {
  await ensureDataFormat();
  await mkdir(ZORA_DIR, { recursive: true });
  await mkdir(WORKSPACE_DATA_ROOT, { recursive: true });
  await mkdir(getWorkspaceDataDir(DEFAULT_WORKSPACE_ID), { recursive: true });
  await mkdir(getWorkspaceFilesDir(DEFAULT_WORKSPACE_ID), { recursive: true });
}

async function backupWorkspaceFile(reason: string): Promise<void> {
  const backupPath = `${WORKSPACES_FILE}.${reason}-${timestampForFileName()}.bak`;

  try {
    await copyFile(WORKSPACES_FILE, backupPath);
    logSystemEvent(
      "store",
      "workspace",
      "backup",
      "已备份 workspace 索引",
      { reason, path: backupPath },
      { level: "warn" }
    );
  } catch (error) {
    if (!isEnoentError(error)) {
      logSystemEvent(
        "store",
        "workspace",
        "backup:error",
        "备份 workspace 索引失败",
        { reason, error: getErrorMessage(error) },
        { level: "warn" }
      );
    }
  }
}

async function readWorkspaceFile(): Promise<WorkspaceFileReadResult> {
  try {
    const raw = await readFile(WORKSPACES_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      await backupWorkspaceFile("invalid");
      logSystemEvent(
        "store",
        "workspace",
        "index:recover",
        "workspace 索引格式异常，尝试从数据目录恢复",
        { reason: "not-array" },
        { level: "warn" }
      );
      return { workspaces: [], shouldRewrite: true };
    }

    const validWorkspaces = parsed.map((item) => decodeWorkspace(item, ZORA_DIR)).filter(isWorkspaceMeta);
    const shouldRewrite = validWorkspaces.length !== parsed.length;

    if (shouldRewrite) {
      await backupWorkspaceFile("invalid-entries");
      logSystemEvent(
        "store",
        "workspace",
        "index:repair",
        "已过滤无效 workspace 记录",
        { dropped: parsed.length - validWorkspaces.length },
        { level: "warn" }
      );
    }

    return { workspaces: validWorkspaces, shouldRewrite };
  } catch (error) {
    if (isEnoentError(error)) {
      return { workspaces: [], shouldRewrite: true };
    }

    if (error instanceof SyntaxError) {
      await backupWorkspaceFile("corrupt");
      logSystemEvent(
        "store",
        "workspace",
        "index:recover",
        "workspace 索引 JSON 损坏，尝试从数据目录恢复",
        { error: getErrorMessage(error) },
        { level: "warn" }
      );
      return { workspaces: [], shouldRewrite: true };
    }

    throw error;
  }
}

async function writeWorkspaceFile(workspaces: WorkspaceMeta[]): Promise<void> {
  await ensureZoraDir();
  await replaceFileAtomically(
    WORKSPACES_FILE,
    JSON.stringify(workspaces.map(encodeWorkspace), null, 2)
  );
  await persistWorkspaceSidecars(workspaces);
}

export function getWorkspaceDataDir(workspaceId: string): string {
  return path.join(WORKSPACE_DATA_ROOT, workspaceId);
}

export function getWorkspaceFilesDir(
  workspaceId = DEFAULT_WORKSPACE_ID
): string {
  return path.join(getWorkspaceDataDir(workspaceId), "files");
}

export function getWorkspaceSessionFilesDir(
  workspaceId: string,
  sessionId: string
): string {
  return path.join(getWorkspaceFilesDir(workspaceId), sessionId);
}

function getWorkspaceSidecarPath(workspaceId: string): string {
  return path.join(getWorkspaceDataDir(workspaceId), WORKSPACE_SIDECAR_FILE);
}

async function persistWorkspaceSidecar(workspace: WorkspaceMeta): Promise<void> {
  await mkdir(getWorkspaceDataDir(workspace.id), { recursive: true });
  await replaceFileAtomically(
    getWorkspaceSidecarPath(workspace.id),
    `${JSON.stringify(encodeWorkspace(workspace), null, 2)}\n`
  );
}

async function persistWorkspaceSidecars(workspaces: WorkspaceMeta[]): Promise<void> {
  const results = await Promise.allSettled(
    workspaces.map((workspace) => persistWorkspaceSidecar(workspace))
  );

  for (const result of results) {
    if (result.status === "rejected") {
      logSystemEvent(
        "store",
        "workspace",
        "sidecar:persist:error",
        "写入 workspace sidecar 失败",
        { error: getErrorMessage(result.reason) },
        { level: "warn" }
      );
    }
  }
}

function isSameWorkspaceMeta(left: WorkspaceMeta | null, right: WorkspaceMeta): boolean {
  return left !== null && isDeepStrictEqual(left, right);
}

async function repairMissingWorkspaceSidecars(workspaces: WorkspaceMeta[]): Promise<void> {
  const results = await Promise.allSettled(
    workspaces.map(async (workspace) => {
      const sidecar = await readWorkspaceSidecar(workspace.id);

      if (isSameWorkspaceMeta(sidecar, workspace)) {
        return;
      }

      await persistWorkspaceSidecar(workspace);
    })
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[workspace-store] Failed to repair workspace sidecar.", result.reason);
    }
  }
}

async function readWorkspaceSidecar(workspaceId: string): Promise<WorkspaceMeta | null> {
  try {
    const raw = await readFile(getWorkspaceSidecarPath(workspaceId), "utf8");
    const parsed = decodeWorkspace(JSON.parse(raw), ZORA_DIR);
    return isWorkspaceMeta(parsed) && parsed.id === workspaceId ? parsed : null;
  } catch (error) {
    if (isEnoentError(error) || error instanceof SyntaxError) {
      return null;
    }

    logSystemEvent(
      "store",
      "workspace",
      "sidecar:read:error",
      "读取 workspace sidecar 失败",
      { workspaceId, error: getErrorMessage(error) },
      { level: "warn" }
    );
    return null;
  }
}

async function recoverWorkspaceFromSessionIndex(
  workspaceId: string
): Promise<WorkspaceMeta | null> {
  try {
    const raw = await readFile(
      path.join(getWorkspaceDataDir(workspaceId), SESSIONS_INDEX_FILE),
      "utf8"
    );
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return null;
    }

    if (parsed.length === 0) {
      return null;
    }

    const now = new Date().toISOString();

    return {
      id: workspaceId,
      name: `恢复的工作区 ${workspaceId.slice(0, 8)}`,
      path: "",
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    if (isEnoentError(error) || error instanceof SyntaxError) {
      return null;
    }

    logSystemEvent(
      "store",
      "workspace",
      "recover:error",
      "从会话索引恢复 workspace 失败",
      { workspaceId, error: getErrorMessage(error) },
      { level: "warn" }
    );
    return null;
  }
}

async function recoverWorkspacesFromDataDirs(
  existingWorkspaces: WorkspaceMeta[]
): Promise<WorkspaceMeta[]> {
  const existingIds = new Set(existingWorkspaces.map((workspace) => workspace.id));

  let entries;
  try {
    entries = await readdir(WORKSPACE_DATA_ROOT, { withFileTypes: true });
  } catch (error) {
    if (isEnoentError(error)) {
      return [];
    }

    throw error;
  }

  const recovered: WorkspaceMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.trim().length === 0 || existingIds.has(entry.name)) {
      continue;
    }

    const sidecar = await readWorkspaceSidecar(entry.name);
    const workspace = sidecar ?? (await recoverWorkspaceFromSessionIndex(entry.name));
    if (!workspace) {
      continue;
    }

    logSystemEvent(
      "store",
      "workspace",
      "recover",
      "已从数据目录恢复 workspace",
      { workspaceId: workspace.id, name: workspace.name },
      { level: "warn" }
    );
    recovered.push(workspace);
    existingIds.add(workspace.id);
  }

  return recovered;
}

async function listWorkspacesUnlocked(): Promise<WorkspaceMeta[]> {
  await ensureZoraDir();

  const workspaceFile = await readWorkspaceFile();
  const recoveredWorkspaces = await recoverWorkspacesFromDataDirs(workspaceFile.workspaces);
  const rawWorkspaces = [...workspaceFile.workspaces, ...recoveredWorkspaces];
  const normalized = normalizeWorkspaces(rawWorkspaces);

  if (
    workspaceFile.shouldRewrite ||
    recoveredWorkspaces.length > 0 ||
    !isDeepStrictEqual(rawWorkspaces, normalized)
  ) {
    await writeWorkspaceFile(normalized);
  } else {
    await repairMissingWorkspaceSidecars(normalized);
  }

  return normalized;
}

async function createWorkspaceUnlocked(
  name: string,
  workspacePath: string
): Promise<WorkspaceMeta> {
  const nextName = name.trim();
  const nextPath = workspacePath.trim();

  if (!nextName) {
    throw new Error("Workspace name is required.");
  }

  if (!nextPath) {
    throw new Error("Workspace path is required.");
  }

  await requireDirectory(nextPath);
  const workspaces = await listWorkspacesUnlocked();
  const now = new Date().toISOString();
  const workspace: WorkspaceMeta = {
    id: randomUUID(),
    name: nextName,
    path: nextPath,
    createdAt: now,
    updatedAt: now,
  };

  await mkdir(getWorkspaceDataDir(workspace.id), { recursive: true });
  await writeWorkspaceFile([...workspaces, workspace]);

  return workspace;
}

async function deleteWorkspaceUnlocked(workspaceId: string): Promise<void> {
  if (workspaceId === DEFAULT_WORKSPACE_ID) {
    throw new Error("Default workspace cannot be deleted.");
  }

  const workspaces = await listWorkspacesUnlocked();
  const filtered = workspaces.filter(
    (workspace) => workspace.id !== workspaceId
  );

  if (filtered.length === workspaces.length) {
    return;
  }

  await writeWorkspaceFile(filtered);
  await rm(getWorkspaceDataDir(workspaceId), { recursive: true, force: true });
}

export async function getWorkspacePath(
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<string> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} does not exist.`);
  }

  return workspace.path;
}

// Index repair, ordinary mutations and rebinding must not overwrite each other.
let workspaceQueue: Promise<unknown> = Promise.resolve();
const BINDING_JOURNAL = path.join(ZORA_DIR, "workspace-binding-operation.json");

type BindingJournal = {
  workspaceId: string;
  workspaceIndex: string;
  sidecar: string | null;
  sessionIndex: string | null;
};

async function readOptionalFile(file: string): Promise<string | null> {
  try { return await readFile(file, "utf8"); }
  catch (error) { if (isEnoentError(error)) return null; throw error; }
}

async function restoreOptionalFile(file: string, content: string | null): Promise<void> {
  if (content === null) await rm(file, { force: true });
  else await replaceFileAtomically(file, content);
}

async function recoverBinding(): Promise<void> {
  const raw = await readOptionalFile(BINDING_JOURNAL);
  if (raw === null) return;
  const journal = JSON.parse(raw) as BindingJournal;
  if (!journal.workspaceId || path.basename(journal.workspaceId) !== journal.workspaceId ||
      [".", "..", DEFAULT_WORKSPACE_ID].includes(journal.workspaceId) ||
      typeof journal.workspaceIndex !== "string" ||
      !(journal.sidecar === null || typeof journal.sidecar === "string") ||
      !(journal.sessionIndex === null || typeof journal.sessionIndex === "string")) {
    throw new Error("项目目录关联记录无法读取，请保留数据并重试");
  }
  await replaceFileAtomically(WORKSPACES_FILE, journal.workspaceIndex);
  await restoreOptionalFile(getWorkspaceSidecarPath(journal.workspaceId), journal.sidecar);
  await restoreOptionalFile(path.join(getWorkspaceDataDir(journal.workspaceId), SESSIONS_INDEX_FILE), journal.sessionIndex);
  await rm(BINDING_JOURNAL);
  setWorkspaceRecoveryPending(journal.workspaceId, false);
}

function serializeWorkspaces<T>(operation: () => Promise<T>): Promise<T> {
  const next = workspaceQueue.catch(() => undefined).then(async () => {
    await recoverBinding();
    return operation();
  });
  workspaceQueue = next;
  return next;
}

export function listWorkspaces(): Promise<WorkspaceMeta[]> {
  return serializeWorkspaces(listWorkspacesUnlocked);
}

export function createWorkspace(name: string, workspacePath: string): Promise<WorkspaceMeta> {
  return serializeWorkspaces(() => createWorkspaceUnlocked(name, workspacePath));
}

export function deleteWorkspace(workspaceId: string): Promise<void> {
  return useWorkspace(workspaceId, () => serializeWorkspaces(() => deleteWorkspaceUnlocked(workspaceId)));
}

export function updateWorkspace(
  workspaceId: string,
  input: { name: string; directory: string },
  isSessionRunning: (sessionId: string) => boolean,
): Promise<WorkspaceMeta> {
  return rebindWorkspaceExclusively(workspaceId, () => serializeWorkspaces(async () => {
    if (workspaceId === DEFAULT_WORKSPACE_ID) throw new Error("默认工作区无需编辑项目");
    const name = input.name.trim();
    if (!name) throw new Error("请输入项目名称");
    if (!input.directory.trim()) throw new Error("请选择本地文件夹");
    const workspaces = await listWorkspacesUnlocked();
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} does not exist.`);
    const nextPath = path.resolve(input.directory.trim());
    const directoryChanged = nextPath !== path.resolve(workspace.path);
    if (directoryChanged) await requireDirectory(nextPath);
    const sessionIndexPath = path.join(getWorkspaceDataDir(workspaceId), SESSIONS_INDEX_FILE);
    const sessionIndex = await readOptionalFile(sessionIndexPath);
    const records = sessionIndex === null ? [] : JSON.parse(sessionIndex) as StoredSession[];
    if (!Array.isArray(records)) throw new Error("会话索引无法读取");
    const sessions = records.map((record) => decodeSession(record, ZORA_DIR, workspace.path));
    if (sessions.some((session) => isSessionRunning(session.id))) throw new Error(PROJECT_DIRECTORY_BUSY);
    const updated = { ...workspace, name, path: nextPath, updatedAt: new Date().toISOString() };
    const rebound = sessions.map((session) => {
      if (!directoryChanged) return session;
      const previousDirectory = session.workingDirectory ?? workspace.path;
      const workingDirectory = session.directory?.kind === "project"
        ? resolveRelative(nextPath, session.directory.path)
        : rebindDirectory(previousDirectory, workspace.path, nextPath);
      if (previousDirectory === workingDirectory && session.workingDirectory) return session;
      return {
        ...session, workingDirectory,
        ...((session.agentRuntimeType === "claude" || (!session.agentRuntimeType && session.sdkSessionId))
          ? { sdkSessionId: undefined, contextWindowState: undefined } : {}),
      };
    });
    const journal: BindingJournal = {
      workspaceId,
      workspaceIndex: (await readFile(WORKSPACES_FILE, "utf8")),
      sidecar: await readOptionalFile(getWorkspaceSidecarPath(workspaceId)),
      sessionIndex,
    };
    await replaceFileAtomically(BINDING_JOURNAL, JSON.stringify(journal));
    setWorkspaceRecoveryPending(workspaceId, true);
    try {
      if (directoryChanged && sessionIndex !== null) await replaceFileAtomically(sessionIndexPath, JSON.stringify(rebound.map((session) => encodeSession(session, ZORA_DIR, nextPath)), null, 2));
      await persistWorkspaceSidecar(updated);
      await replaceFileAtomically(WORKSPACES_FILE, JSON.stringify(workspaces.map((item) => encodeWorkspace(item.id === workspaceId ? updated : item)), null, 2));
      await rm(BINDING_JOURNAL);
      setWorkspaceRecoveryPending(workspaceId, false);
    } catch (error) {
      await recoverBinding();
      throw error;
    }
    return updated;
  }));
}
