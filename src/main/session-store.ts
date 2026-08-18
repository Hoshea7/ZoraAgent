import { randomUUID } from "node:crypto";
import {
  access,
  appendFile,
  cp,
  mkdir,
  readFile,
  rename as fsRename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  ArchivedSessionEntry,
  AgentRuntimeType,
  AssistantAction,
  AssistantTurn,
  ConversationMessage,
  DelegationInvocationRecord,
  FileAttachment,
  PermissionMode,
  ProcessStep,
  SessionArchiveScope,
  SessionForkRequest,
  SessionMeta,
  SubtaskRole,
  SubtaskStatus,
} from "../shared/zora";
import type { ReasoningLevel } from "../shared/types/provider";
import { extractScheduleDetailLinkFromToolResultValue } from "../shared/schedule-link";
import {
  DEFAULT_WORKSPACE_ID,
  getWorkspaceSessionFilesDir,
  listWorkspaces,
} from "./workspace-store";
import { getErrorMessage, logSystemEvent } from "./system-log";
import { isRecord } from "./utils/guards";
import { isEnoentError, replaceFileAtomically, ZORA_DIR } from "./utils/fs";
import {
  deleteBySession as deleteDelegationResultsBySession,
  getResult as getDelegationResult,
} from "./delegation/result-store";
import {
  attachmentResourceModule,
  type PersistedAttachmentRecord,
} from "./attachment-resource";
import { getPiSessionRuntimeDir } from "./session-artifacts";

export type SavedAttachmentMeta = PersistedAttachmentRecord;

export interface CreateForkedSessionInput extends SessionForkRequest {
  id?: string;
  sourceSdkSessionId?: string;
  sdkSessionId?: string;
  agentRuntimeType?: "claude" | "pi";
  workingDirectory?: string;
  transcriptCopyOptions?: ForkTranscriptCopyOptions;
}

export interface ForkTranscriptCopyOptions {
  assistantTurnIdRewrites?: ReadonlyMap<string, string>;
}

export interface ListSessionsOptions {
  includeArchived?: boolean;
  archivedOnly?: boolean;
}

export interface CreateDelegatedSessionInput {
  id: string;
  title: string;
  workspaceId: string;
  parentSessionId: string;
  role: SubtaskRole;
  goal: string;
  runId: string;
  attempt: number;
  revision: number;
  creationInvocation: DelegationInvocationRecord;
  providerId: string;
  selectedModelId: string;
  agentRuntimeType: AgentRuntimeType;
  reasoningLevel?: ReasoningLevel;
  permissionMode: PermissionMode;
}

const OLD_SESSIONS_DIR = path.join(ZORA_DIR, "sessions");
const HISTORY_IMAGE_BASE64_LIMIT = 20;
const HISTORY_IMAGE_MAX_INLINE_BYTES = 5 * 1024 * 1024;

function getSessionsDir(workspaceId = "default"): string {
  return path.join(ZORA_DIR, "workspaces", workspaceId, "sessions");
}

function getIndexFile(workspaceId = "default"): string {
  return path.join(getSessionsDir(workspaceId), "index.json");
}

const sessionWriteQueues = new Map<string, Promise<void>>();
const sessionIndexQueues = new Map<string, Promise<void>>();
const recoveredCompactionWorkspaces = new Set<string>();
let migrationDone = false;

function getSessionWriteQueueKey(sessionId: string, workspaceId: string): string {
  return `${workspaceId}\0${sessionId}`;
}

async function runQueuedSessionWrite(
  sessionId: string,
  workspaceId: string,
  task: () => Promise<void>
): Promise<void> {
  const queueKey = getSessionWriteQueueKey(sessionId, workspaceId);
  const previous = sessionWriteQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);

  sessionWriteQueues.set(queueKey, next);

  try {
    await next;
  } finally {
    if (sessionWriteQueues.get(queueKey) === next) {
      sessionWriteQueues.delete(queueKey);
    }
  }
}

export async function flushSessionWrites(
  sessionId: string,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  const queueKey = getSessionWriteQueueKey(sessionId, workspaceId);
  let pending = sessionWriteQueues.get(queueKey);

  while (pending) {
    await pending;
    pending = sessionWriteQueues.get(queueKey);
  }
}

export async function migrateSessionsIfNeeded(): Promise<void> {
  if (migrationDone) {
    return;
  }

  migrationDone = true;

  const newDir = getSessionsDir("default");

  try {
    await access(OLD_SESSIONS_DIR);
  } catch {
    return;
  }

  try {
    await access(newDir);
    logSystemEvent(
      "store",
      "session",
      "migration:skip",
      "新版会话目录已存在，跳过旧目录迁移"
    );
    return;
  } catch {
    // The workspace-aware directory does not exist yet, continue migrating.
  }

  await mkdir(path.join(ZORA_DIR, "workspaces", "default"), { recursive: true });
  await fsRename(OLD_SESSIONS_DIR, newDir);
  logSystemEvent(
    "store",
    "session",
    "migration:done",
    "旧版会话目录已迁移到默认工作区"
  );
}

async function ensureSessionsDir(workspaceId = "default"): Promise<void> {
  await migrateSessionsIfNeeded();
  await mkdir(getSessionsDir(workspaceId), { recursive: true });
}

async function readIndex(workspaceId = "default"): Promise<SessionMeta[]> {
  await migrateSessionsIfNeeded();

  try {
    const raw = await readFile(getIndexFile(workspaceId), "utf8");
    return JSON.parse(raw) as SessionMeta[];
  } catch {
    return [];
  }
}

async function writeIndex(
  sessions: SessionMeta[],
  workspaceId = "default"
): Promise<void> {
  await ensureSessionsDir(workspaceId);
  await replaceFileAtomically(
    getIndexFile(workspaceId),
    JSON.stringify(sessions, null, 2)
  );
}

async function mutateSessionIndex<T>(
  workspaceId: string,
  mutation: (sessions: SessionMeta[]) => Promise<T> | T
): Promise<T> {
  const previous = sessionIndexQueues.get(workspaceId) ?? Promise.resolve();
  let result!: T;
  const next = previous.catch(() => undefined).then(async () => {
    const sessions = await readIndex(workspaceId);
    result = await mutation(sessions);
    await writeIndex(sessions, workspaceId);
  });

  sessionIndexQueues.set(workspaceId, next);
  try {
    await next;
    return result;
  } finally {
    if (sessionIndexQueues.get(workspaceId) === next) {
      sessionIndexQueues.delete(workspaceId);
    }
  }
}

async function recoverInterruptedCompactionStates(
  workspaceId: string
): Promise<void> {
  if (recoveredCompactionWorkspaces.has(workspaceId)) return;

  const persisted = await readIndex(workspaceId);
  if (
    !persisted.some(
      (session) => session.contextWindowState?.status === "compacting"
    )
  ) {
    recoveredCompactionWorkspaces.add(workspaceId);
    return;
  }

  await mutateSessionIndex(workspaceId, (sessions) => {
    for (let index = 0; index < sessions.length; index += 1) {
      const state = sessions[index].contextWindowState;
      if (state?.status !== "compacting") continue;
      sessions[index] = {
        ...sessions[index],
        contextWindowState: { ...state, status: "ready" },
      };
    }
  });
  recoveredCompactionWorkspaces.add(workspaceId);
}

function normalizePersistedPath(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isArchivedSession(session: SessionMeta): boolean {
  return typeof session.archivedAt === "string" && session.archivedAt.length > 0;
}

function filterSessionsByArchiveState(
  sessions: SessionMeta[],
  options: ListSessionsOptions = {}
): SessionMeta[] {
  if (options.includeArchived) {
    return sessions;
  }

  if (options.archivedOnly) {
    return sessions.filter(isArchivedSession);
  }

  return sessions.filter((session) => !isArchivedSession(session));
}

async function getWorkspaceForSession(workspaceId: string) {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} does not exist.`);
  }

  return workspace;
}

async function resolveNewSessionWorkingDirectory(
  sessionId: string,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<string> {
  const workspace = await getWorkspaceForSession(workspaceId);

  if (workspace.id === DEFAULT_WORKSPACE_ID) {
    return getWorkspaceSessionFilesDir(workspace.id, sessionId);
  }

  return workspace.path;
}

async function resolveLegacySessionWorkingDirectory(
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<string> {
  const workspace = await getWorkspaceForSession(workspaceId);

  if (workspace.id === DEFAULT_WORKSPACE_ID) {
    return homedir();
  }

  return workspace.path;
}

function isManagedSessionWorkingDirectory(
  sessionId: string,
  workspaceId: string,
  workingDirectory?: string
): boolean {
  const normalizedWorkingDirectory = normalizePersistedPath(workingDirectory);

  if (!normalizedWorkingDirectory) {
    return false;
  }

  return (
    path.resolve(normalizedWorkingDirectory) ===
    path.resolve(getWorkspaceSessionFilesDir(workspaceId, sessionId))
  );
}

async function removeManagedSessionWorkingDirectory(
  sessionId: string,
  workspaceId: string,
  workingDirectory?: string
): Promise<void> {
  const normalizedWorkingDirectory = normalizePersistedPath(workingDirectory);

  if (
    !normalizedWorkingDirectory ||
    !isManagedSessionWorkingDirectory(
      sessionId,
      workspaceId,
      normalizedWorkingDirectory
    )
  ) {
    return;
  }

  await rm(normalizedWorkingDirectory, {
    recursive: true,
    force: true,
  });
}

export async function deleteManagedSessionWorkingDirectory(
  sessionId: string,
  workspaceId: string,
  workingDirectory?: string
): Promise<void> {
  await removeManagedSessionWorkingDirectory(
    sessionId,
    workspaceId,
    workingDirectory
  );
}

async function hydrateSessionWorkingDirectories(
  sessions: SessionMeta[],
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<SessionMeta[]> {
  let didChange = false;
  const hydrated: SessionMeta[] = [];
  const needsLegacyWorkingDirectory = sessions.some(
    (session) => !normalizePersistedPath(session.workingDirectory)
  );
  const legacyWorkingDirectory = needsLegacyWorkingDirectory
    ? await resolveLegacySessionWorkingDirectory(workspaceId)
    : undefined;

  for (const session of sessions) {
    const workingDirectory = normalizePersistedPath(session.workingDirectory);

    if (workingDirectory) {
      hydrated.push(
        workingDirectory === session.workingDirectory
          ? session
          : { ...session, workingDirectory }
      );
      didChange = didChange || workingDirectory !== session.workingDirectory;
      continue;
    }

    hydrated.push({
      ...session,
      workingDirectory: legacyWorkingDirectory,
    });
    didChange = true;
  }

  if (didChange) {
    await mutateSessionIndex(workspaceId, (current) => {
      for (const hydratedSession of hydrated) {
        const index = current.findIndex((item) => item.id === hydratedSession.id);
        if (
          index !== -1 &&
          !normalizePersistedPath(current[index].workingDirectory)
        ) {
          current[index] = hydratedSession;
        }
      }
    });
  }

  return hydrated;
}

export async function createSessionWorkingDirectory(
  sessionId: string,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<string> {
  const workingDirectory = await resolveNewSessionWorkingDirectory(
    sessionId,
    workspaceId
  );
  await mkdir(workingDirectory, { recursive: true });
  return workingDirectory;
}

export async function getSessionWorkingDirectory(
  sessionId: string,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<string> {
  await ensureSessionsDir(workspaceId);

  const workingDirectory = await mutateSessionIndex(workspaceId, async (sessions) => {
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index === -1) throw new Error(`Session ${sessionId} not found.`);
    const existing = normalizePersistedPath(sessions[index].workingDirectory);
    if (existing) return existing;
    const legacy = await resolveLegacySessionWorkingDirectory(workspaceId);
    sessions[index] = { ...sessions[index], workingDirectory: legacy };
    return legacy;
  });
  await mkdir(workingDirectory, { recursive: true });
  return workingDirectory;
}

export async function copySessionWorkingDirectory(
  sourceSessionId: string,
  targetSessionId: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
  sourceWorkingDirectoryInput?: string
): Promise<void> {
  const sourceWorkingDirectory =
    sourceWorkingDirectoryInput ??
    (await getSessionWorkingDirectory(sourceSessionId, workspaceId));
  const targetWorkingDirectory = getWorkspaceSessionFilesDir(
    workspaceId,
    targetSessionId
  );

  if (
    !isManagedSessionWorkingDirectory(
      sourceSessionId,
      workspaceId,
      sourceWorkingDirectory
    )
  ) {
    return;
  }

  try {
    await cp(sourceWorkingDirectory, targetWorkingDirectory, {
      recursive: true,
      force: true,
    });
  } catch (error) {
    if (isEnoentError(error)) {
      return;
    }

    throw error;
  }
}

export async function listSessions(
  workspaceId = "default",
  options: ListSessionsOptions = {}
): Promise<SessionMeta[]> {
  await ensureSessionsDir(workspaceId);
  await recoverInterruptedCompactionStates(workspaceId);
  const hydrated = await hydrateSessionWorkingDirectories(
    await readIndex(workspaceId),
    workspaceId
  );
  return filterSessionsByArchiveState(hydrated, options);
}

export async function listArchivedSessions(): Promise<ArchivedSessionEntry[]> {
  const workspaces = await listWorkspaces();
  const entries = await Promise.all(
    workspaces.map(async (workspace) => {
      const sessions = await listSessions(workspace.id, { archivedOnly: true });
      return sessions.map((session) => ({
        session,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspacePath: workspace.path,
      }));
    })
  );

  return entries
    .flat()
    .sort((left, right) => {
      const leftTime = left.session.archivedAt ?? left.session.updatedAt;
      const rightTime = right.session.archivedAt ?? right.session.updatedAt;
      return new Date(rightTime).getTime() - new Date(leftTime).getTime();
    });
}

export async function createSession(
  title: string,
  workspaceId = "default",
  permissionMode: PermissionMode = "ask"
): Promise<SessionMeta> {
  await ensureSessionsDir(workspaceId);

  const now = new Date().toISOString();
  const sessionId = randomUUID();
  const workingDirectory = await createSessionWorkingDirectory(
    sessionId,
    workspaceId
  );
  const meta: SessionMeta = {
    id: sessionId,
    title,
    createdAt: now,
    updatedAt: now,
    workingDirectory,
    permissionMode,
  };

  return mutateSessionIndex(workspaceId, (sessions) => {
    sessions.unshift(meta);
    return meta;
  });
}

export async function createDelegatedSession(
  input: CreateDelegatedSessionInput
): Promise<SessionMeta> {
  return mutateSessionIndex(input.workspaceId, (sessions) => {
    const parent = sessions.find((session) => session.id === input.parentSessionId);
    if (!parent || isArchivedSession(parent)) {
      throw new Error(`Parent session ${input.parentSessionId} not found.`);
    }
    if (parent.parentSessionId || parent.delegationDepth) {
      throw new Error("Delegated sessions cannot create child sessions.");
    }
    const workingDirectory = normalizePersistedPath(parent.workingDirectory);
    if (!workingDirectory) {
      throw new Error(`Parent session ${input.parentSessionId} has no working directory.`);
    }
    if (sessions.some((session) => session.id === input.id)) {
      throw new Error(`Session ${input.id} already exists.`);
    }

    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id: input.id,
      title: input.title,
      createdAt: now,
      updatedAt: now,
      providerId: input.providerId,
      providerLocked: true,
      selectedModelId: input.selectedModelId,
      workingDirectory,
      agentRuntimeType: input.agentRuntimeType,
      reasoningLevel: input.reasoningLevel,
      permissionMode: input.permissionMode,
      parentSessionId: parent.id,
      rootSessionId: parent.rootSessionId ?? parent.id,
      delegationDepth: 1,
      delegationRole: input.role,
      delegationGoal: input.goal,
      delegationStatus: "running",
      delegationRunId: input.runId,
      delegationAttempt: input.attempt,
      delegationRevision: input.revision,
      delegationStartedAt: Date.now(),
      delegationCreationInvocation: input.creationInvocation,
      workingDirectoryOwnerSessionId:
        parent.workingDirectoryOwnerSessionId ?? parent.id,
    };
    sessions.unshift(meta);
    return meta;
  });
}

async function copySessionTranscript(
  sourceSessionId: string,
  targetSessionId: string,
  workspaceId = "default",
  upToMessageId?: string,
  options?: ForkTranscriptCopyOptions
): Promise<{
  inheritedMessageCount: number;
  copiedAttachmentFileNames?: Set<string>;
}> {
  const forkPointMessageId = upToMessageId?.trim() || undefined;
  const sourcePath = getJsonlPath(sourceSessionId, workspaceId);
  let content: string;

  try {
    content = await readFile(sourcePath, "utf8");
  } catch (error) {
    if (isEnoentError(error)) {
      return {
        inheritedMessageCount: 0,
        copiedAttachmentFileNames: forkPointMessageId ? new Set() : undefined,
      };
    }

    throw error;
  }

  const copiedLines: string[] = [];
  const copiedAttachmentFileNames = forkPointMessageId ? new Set<string>() : undefined;
  let foundForkPoint = !forkPointMessageId;
  let inheritedMessageCount = 0;
  let lastConversationKind: "assistant" | "user" | null = null;

  for (const line of content.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    let copiedLine = line;
    let shouldStopAtForkPoint = false;

    try {
      const record = JSON.parse(line) as MessageRecord | {
        kind: "assistant_block";
        message: unknown;
      };

      if (record.kind === "user") {
        inheritedMessageCount += 1;
        lastConversationKind = "user";
        collectSavedAttachmentFileNames(
          record.message.attachments,
          copiedAttachmentFileNames
        );
      }

      if (record.kind === "assistant_turn") {
        const turn = normalizeTurn(record.turn);
        if (turn) {
          if (lastConversationKind !== "assistant") {
            inheritedMessageCount += 1;
          }
          lastConversationKind = "assistant";

          if (turn.id === forkPointMessageId) {
            foundForkPoint = true;
            shouldStopAtForkPoint = true;
          }

          const remappedTurn = remapAssistantTurnId(
            turn,
            options?.assistantTurnIdRewrites
          );
          if (remappedTurn !== turn) {
            copiedLine = JSON.stringify({
              ...record,
              turn: remappedTurn,
            });
          }
        }
      }

      if (record.kind === "assistant_block" && restoreLegacyAssistantBlock(record.message)) {
        inheritedMessageCount += 1;
        lastConversationKind = "assistant";
      }
    } catch {
      // Preserve malformed historical lines in the copied transcript.
    }

    copiedLines.push(copiedLine);

    if (shouldStopAtForkPoint) {
      break;
    }
  }

  if (!foundForkPoint) {
    throw new Error(`Fork message ${forkPointMessageId} not found in source transcript.`);
  }

  await writeFile(
    getJsonlPath(targetSessionId, workspaceId),
    copiedLines.length > 0 ? `${copiedLines.join("\n")}\n` : "",
    "utf8"
  );

  return {
    inheritedMessageCount,
    copiedAttachmentFileNames,
  };
}

function remapAssistantTurnId(
  turn: AssistantTurn,
  assistantTurnIdMap?: ReadonlyMap<string, string>
): AssistantTurn {
  if (!assistantTurnIdMap || assistantTurnIdMap.size === 0) {
    return turn;
  }

  const remappedId = assistantTurnIdMap.get(turn.id);
  if (!remappedId || remappedId === turn.id) {
    return turn;
  }

  return {
    ...turn,
    id: remappedId,
  };
}

async function copySessionAttachments(
  sourceSessionId: string,
  targetSessionId: string,
  workspaceId = "default",
  attachmentIds?: Set<string>
): Promise<void> {
  await attachmentResourceModule.fork(
    workspaceId,
    sourceSessionId,
    targetSessionId,
    attachmentIds
  );
}

async function removeSessionArtifacts(
  sessionId: string,
  workspaceId = "default",
  workingDirectory?: string
): Promise<void> {
  await Promise.allSettled([
    unlink(getJsonlPath(sessionId, workspaceId)),
    rm(getAttachmentsDir(sessionId, workspaceId), {
      recursive: true,
      force: true,
    }),
    rm(getPiSessionRuntimeDir(workspaceId, sessionId), {
      recursive: true,
      force: true,
    }),
    removeManagedSessionWorkingDirectory(sessionId, workspaceId, workingDirectory),
  ]);
}

function collectSavedAttachmentFileNames(
  attachments: unknown,
  fileNames?: Set<string>
): void {
  if (!fileNames || !Array.isArray(attachments)) {
    return;
  }

  for (const attachment of attachments) {
    if (!isRecord(attachment) || typeof attachment.attachmentId !== "string") {
      continue;
    }
    const attachmentId = attachment.attachmentId.trim();
    if (attachmentId) fileNames.add(attachmentId);
  }
}

export async function createForkedSession(
  input: CreateForkedSessionInput,
  workspaceId = "default"
): Promise<SessionMeta> {
  await ensureSessionsDir(workspaceId);

  const sessions = await readIndex(workspaceId);
  const source = sessions.find((session) => session.id === input.sourceSessionId);

  if (!source) {
    throw new Error(`Source session ${input.sourceSessionId} not found.`);
  }

  await flushSessionWrites(input.sourceSessionId, workspaceId);

  const now = new Date().toISOString();
  const title = input.title?.trim() || source.title;
  const upToMessageId = input.upToMessageId?.trim() || undefined;
  const sessionId = input.id ?? randomUUID();
  const workingDirectory =
    normalizePersistedPath(input.workingDirectory) ??
    (await createSessionWorkingDirectory(sessionId, workspaceId));
  await mkdir(workingDirectory, { recursive: true });

  try {
    const transcriptCopy = await copySessionTranscript(
      source.id,
      sessionId,
      workspaceId,
      upToMessageId,
      input.transcriptCopyOptions
    );
    const meta: SessionMeta = {
      id: sessionId,
      title,
      createdAt: now,
      updatedAt: now,
      sdkSessionId: input.sdkSessionId,
      providerLocked: false,
      workingDirectory,
      agentRuntimeType: input.agentRuntimeType,
      permissionMode: source.permissionMode ?? "ask",
      branch: {
        sourceSessionId: source.id,
        sourceSdkSessionId: input.sourceSdkSessionId,
        forkedAt: now,
        forkMode: upToMessageId ? "message" : "full",
        forkedFromMessageId: upToMessageId,
        inheritedMessageCount: transcriptCopy.inheritedMessageCount,
      },
    };
    await copySessionAttachments(
      source.id,
      meta.id,
      workspaceId,
      transcriptCopy.copiedAttachmentFileNames
    );
    await mutateSessionIndex(workspaceId, (current) => {
      if (!current.some((session) => session.id === source.id)) {
        throw new Error(`Source session ${source.id} not found.`);
      }
      if (current.some((session) => session.id === meta.id)) {
        throw new Error(`Session ${meta.id} already exists.`);
      }
      current.unshift(meta);
    });

    return meta;
  } catch (error) {
    await removeSessionArtifacts(sessionId, workspaceId, workingDirectory);
    throw error;
  }
}

export async function deleteSession(
  sessionId: string,
  workspaceId = "default"
): Promise<void> {
  await ensureSessionsDir(workspaceId);

  const removed = await mutateSessionIndex(workspaceId, (sessions) => {
    const target = sessions.find((item) => item.id === sessionId);
    if (!target) return [];
    const ids = new Set([sessionId]);
    if (!target.parentSessionId) {
      for (const session of sessions) {
        if (session.parentSessionId === sessionId) ids.add(session.id);
      }
    }
    const selected = sessions.filter((session) => ids.has(session.id));
    sessions.splice(0, sessions.length, ...sessions.filter((session) => !ids.has(session.id)));
    return selected;
  });
  await Promise.all(
    removed.map(async (session) => {
      await Promise.all([
        removeSessionArtifacts(session.id, workspaceId, session.workingDirectory),
        deleteDelegationResultsBySession(workspaceId, session.id),
      ]);
    })
  );
}

async function setSessionArchiveState(
  sessionId: string,
  archivedAt: string | undefined,
  workspaceId = "default",
  scope: SessionArchiveScope = "session"
): Promise<SessionMeta | null> {
  await ensureSessionsDir(workspaceId);

  return mutateSessionIndex(workspaceId, async (sessions) => {
    if (sessions.some((session) => !normalizePersistedPath(session.workingDirectory))) {
      const legacyWorkingDirectory = await resolveLegacySessionWorkingDirectory(workspaceId);
      for (const session of sessions) {
        if (!normalizePersistedPath(session.workingDirectory)) {
          session.workingDirectory = legacyWorkingDirectory;
        }
      }
    }
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) return null;
    const familyRootId = target.parentSessionId ?? target.id;
    const family = sessions.filter(
      (session) => session.id === familyRootId || session.parentSessionId === familyRootId
    );
    const selected = archivedAt
      ? target.parentSessionId && scope === "session"
        ? [target]
        : family
      : target.archivedAt
        ? family.filter((session) => session.archivedAt === target.archivedAt)
        : [];
    if (archivedAt && selected.some((session) => session.delegationStatus === "running")) {
      throw new Error("存在运行中的子任务，结束后再归档。");
    }
    const now = new Date().toISOString();
    for (const session of selected) {
      session.updatedAt = now;
      if (archivedAt) session.archivedAt = archivedAt;
      else delete session.archivedAt;
    }
    return sessions.find((session) => session.id === sessionId) ?? null;
  });
}

export async function recoverDelegationState(): Promise<number> {
  const workspaces = await listWorkspaces();
  let recovered = 0;
  for (const workspace of workspaces) {
    recovered += await mutateSessionIndex(workspace.id, async (sessions) => {
      let count = 0;
      for (const session of sessions) {
        if (session.parentSessionId && session.delegationStatus === "running") {
          const runId = session.delegationRunId;
          if (!runId) continue;
          const persisted = await getDelegationResult(workspace.id, session.id, runId);
          const completedAt = persisted?.completedAt ?? Date.now();
          const status = persisted?.status ?? "interrupted";
          const error = persisted?.error ?? "应用重启，原运行已中断";
          session.delegationStatus = status;
          session.delegationCompletedAt = completedAt;
          session.delegationError = error;
          session.delegationRevision = (session.delegationRevision ?? 0) + 1;
          session.updatedAt = new Date().toISOString();
          count += 1;
        }
      }
      return count;
    });
  }
  return recovered;
}

export async function archiveSession(
  sessionId: string,
  workspaceId = "default",
  scope: SessionArchiveScope = "session"
): Promise<SessionMeta | null> {
  return setSessionArchiveState(
    sessionId,
    new Date().toISOString(),
    workspaceId,
    scope
  );
}

export async function restoreSession(
  sessionId: string,
  workspaceId = "default"
): Promise<SessionMeta | null> {
  return setSessionArchiveState(sessionId, undefined, workspaceId);
}

export async function updateSessionMeta(
  sessionId: string,
  updates: Partial<
    Pick<
      SessionMeta,
      | "title"
      | "sdkSessionId"
      | "providerId"
      | "providerLocked"
      | "selectedModelId"
      | "workingDirectory"
      | "archivedAt"
      | "agentRuntimeType"
      | "reasoningLevel"
      | "permissionMode"
      | "delegationStatus"
      | "delegationRunId"
      | "delegationRevision"
      | "delegationAttempt"
      | "delegationStartedAt"
      | "delegationCompletedAt"
      | "delegationError"
      | "delegationContinueInvocations"
      | "runtimeProjectionFingerprint"
      | "contextWindowState"
    >
  >,
  workspaceId = "default"
): Promise<void> {
  await mutateSessionIndex(workspaceId, (sessions) => {
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index === -1) {
      return;
    }
    sessions[index] = {
      ...sessions[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
  });
}

export async function getSessionMeta(
  sessionId: string,
  workspaceId = "default"
): Promise<SessionMeta | null> {
  await ensureSessionsDir(workspaceId);
  await recoverInterruptedCompactionStates(workspaceId);
  const sessions = await hydrateSessionWorkingDirectories(
    await readIndex(workspaceId),
    workspaceId
  );
  return sessions.find((session) => session.id === sessionId) ?? null;
}

export async function renameSession(
  sessionId: string,
  title: string,
  workspaceId = "default"
): Promise<void> {
  await updateSessionMeta(sessionId, { title }, workspaceId);
}

export async function setSdkSessionId(
  sessionId: string,
  sdkSessionId: string,
  workspaceId = "default"
): Promise<void> {
  await updateSessionMeta(sessionId, { sdkSessionId }, workspaceId);
}

export async function clearSdkSessionId(
  sessionId: string,
  workspaceId = "default"
): Promise<void> {
  await updateSessionMeta(sessionId, { sdkSessionId: undefined }, workspaceId);
}

export async function getSdkSessionId(
  sessionId: string,
  workspaceId = "default"
): Promise<string | undefined> {
  await ensureSessionsDir(workspaceId);
  const sessions = await readIndex(workspaceId);
  return sessions.find((session) => session.id === sessionId)?.sdkSessionId;
}

type PersistedUserMessage = Omit<ConversationMessage, "attachments" | "turn"> & {
  role: "user";
  attachments?: SavedAttachmentMeta[];
};

type MessageRecord =
  | {
      kind: "user";
      message: PersistedUserMessage;
    }
  | { kind: "assistant_turn"; turn: AssistantTurn }
  | {
      kind: "tool_result";
      toolUseId: string;
      result: string;
      isError: boolean;
      completedAt?: number;
      assistantActions?: AssistantAction[];
    };

export function getSessionJsonlPath(
  sessionId: string,
  workspaceId = "default"
): string {
  return getJsonlPath(sessionId, workspaceId);
}

function getJsonlPath(sessionId: string, workspaceId = "default"): string {
  return path.join(getSessionsDir(workspaceId), `${sessionId}.jsonl`);
}

function getAttachmentsDir(sessionId: string, workspaceId = "default"): string {
  return path.join(getSessionsDir(workspaceId), "attachments", sessionId);
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function stringifyPersistedValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function sanitizeToolResultContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .flatMap((block) => {
        if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
          return [];
        }
        return [block.text];
      })
      .join("\n");
  }
  if (isRecord(value) && value.type === "text" && typeof value.text === "string") {
    return value.text;
  }
  return stringifyPersistedValue(value);
}

function createAssistantMessageFromTurn(turn: AssistantTurn): ConversationMessage {
  return {
    id: turn.id,
    role: "assistant",
    turn,
    timestamp: turn.startedAt,
  };
}

function getAssistantActionKey(action: AssistantAction): string {
  if (action.type === "schedule-task-link") {
    return `${action.type}:${action.link.workspaceId}:${action.link.taskId}`;
  }

  return action.type;
}

function normalizeAssistantActions(value: unknown): AssistantAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const actions: AssistantAction[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!isRecord(item) || item.type !== "schedule-task-link") {
      continue;
    }

    const link = extractScheduleDetailLinkFromToolResultValue({
      detailLink: item.link,
    });

    if (!link) {
      continue;
    }

    const action: AssistantAction = {
      type: "schedule-task-link",
      link,
    };
    const key = getAssistantActionKey(action);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    actions.push(action);
  }

  return actions;
}

function toAssistantActions(value: unknown): AssistantAction[] | undefined {
  const actions = normalizeAssistantActions(value);

  return actions.length > 0 ? actions : undefined;
}

function mergeAssistantActions(
  existingActions: AssistantAction[] | undefined,
  nextActions: AssistantAction[] | undefined
): AssistantAction[] | undefined {
  if (!nextActions || nextActions.length === 0) {
    return existingActions;
  }

  const merged = existingActions ? [...existingActions] : [];
  const seen = new Set(merged.map(getAssistantActionKey));

  for (const action of nextActions) {
    const key = getAssistantActionKey(action);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(action);
  }

  return merged;
}

function extractAssistantActionsFromToolResult(content: unknown): AssistantAction[] {
  const link = extractScheduleDetailLinkFromToolResultValue(content);

  return link
    ? [
        {
          type: "schedule-task-link",
          link,
        },
      ]
    : [];
}

function mergeAssistantTurns(
  existingTurn: AssistantTurn,
  nextTurn: AssistantTurn
): AssistantTurn {
  const actions = mergeAssistantActions(existingTurn.actions, nextTurn.actions);
  const error = nextTurn.error ?? existingTurn.error;
  const {
    actions: _existingActions,
    error: _existingError,
    ...existingBaseTurn
  } = existingTurn;
  const mergedTurn: AssistantTurn = {
    ...existingBaseTurn,
    id: nextTurn.id,
    processSteps: [...existingTurn.processSteps, ...nextTurn.processSteps],
    bodySegments: [...existingTurn.bodySegments, ...nextTurn.bodySegments],
    status: "done",
    completedAt: nextTurn.completedAt ?? existingTurn.completedAt,
  };

  if (actions) {
    mergedTurn.actions = actions;
  }

  if (error) {
    mergedTurn.error = error;
  }

  return mergedTurn;
}

function normalizeTurn(rawTurn: unknown): AssistantTurn | null {
  if (!isRecord(rawTurn)) {
    return null;
  }

  const startedAt =
    typeof rawTurn.startedAt === "number" ? rawTurn.startedAt : Date.now();
  const completedAt =
    typeof rawTurn.completedAt === "number" ? rawTurn.completedAt : undefined;
  const status =
    rawTurn.status === "streaming" ||
    rawTurn.status === "done" ||
    rawTurn.status === "stopped" ||
    rawTurn.status === "error"
      ? rawTurn.status
      : "done";

  const bodySegments = Array.isArray(rawTurn.bodySegments)
    ? rawTurn.bodySegments.flatMap((segment) => {
        if (!isRecord(segment)) {
          return [];
        }

        return [
          {
            id: typeof segment.id === "string" ? segment.id : makeId("segment"),
            text: typeof segment.text === "string" ? segment.text : "",
          },
        ];
      })
    : [];

  const processSteps = Array.isArray(rawTurn.processSteps)
    ? rawTurn.processSteps.reduce<ProcessStep[]>((steps, step) => {
        if (!isRecord(step)) {
          return steps;
        }

        if (step.type === "thinking" && isRecord(step.thinking)) {
          steps.push({
            type: "thinking",
            thinking: {
              id:
                typeof step.thinking.id === "string"
                  ? step.thinking.id
                  : makeId("thinking"),
              content:
                typeof step.thinking.content === "string"
                  ? step.thinking.content
                  : "",
              startedAt:
                typeof step.thinking.startedAt === "number"
                  ? step.thinking.startedAt
                  : startedAt,
              completedAt:
                typeof step.thinking.completedAt === "number"
                  ? step.thinking.completedAt
                  : undefined,
            },
          });
          return steps;
        }

        if (step.type === "tool" && isRecord(step.tool)) {
          steps.push({
            type: "tool",
            tool: {
              id:
                typeof step.tool.id === "string" ? step.tool.id : makeId("tool"),
              name:
                typeof step.tool.name === "string" ? step.tool.name : "unknown",
              input:
                typeof step.tool.input === "string" ? step.tool.input : "",
              result:
                typeof step.tool.result === "string" ? step.tool.result : undefined,
              status:
                step.tool.status === "done" ||
                step.tool.status === "error" ||
                step.tool.status === "running"
                  ? step.tool.status
                  : "running",
              startedAt:
                typeof step.tool.startedAt === "number"
                  ? step.tool.startedAt
                  : startedAt,
              completedAt:
                typeof step.tool.completedAt === "number"
                  ? step.tool.completedAt
                  : undefined,
            },
          });
        }

        return steps;
      }, [])
    : [];

  return {
    id: typeof rawTurn.id === "string" ? rawTurn.id : makeId("turn"),
    processSteps,
    bodySegments,
    actions: toAssistantActions(rawTurn.actions),
    status,
    error: typeof rawTurn.error === "string" ? rawTurn.error : undefined,
    startedAt,
    completedAt,
  };
}

function applyToolResultToTurn(
  turn: AssistantTurn,
  toolUseId: string,
  result: string,
  isError: boolean,
  completedAt?: number,
  assistantActions?: AssistantAction[]
) {
  if (!turn.processSteps.some((step) => step.type === "tool" && step.tool.id === toolUseId)) {
    return turn;
  }

  return {
    ...turn,
    actions: mergeAssistantActions(turn.actions, assistantActions),
    processSteps: turn.processSteps.map<ProcessStep>((step) =>
      step.type === "tool" && step.tool.id === toolUseId
        ? {
            type: "tool",
            tool: {
              ...step.tool,
              result,
              status: isError ? "error" : "done",
              completedAt: step.tool.completedAt ?? completedAt ?? turn.completedAt,
            },
          }
        : step
    ),
  };
}

function restoreLegacyAssistantBlock(message: unknown): ConversationMessage | null {
  if (!isRecord(message)) {
    return null;
  }

  const now = Date.now();
  const turnId = typeof message.id === "string" ? message.id : makeId("turn");
  const status =
    message.status === "streaming" ||
    message.status === "done" ||
    message.status === "stopped" ||
    message.status === "error"
      ? message.status
      : "done";

  const turn: AssistantTurn = {
    id: turnId,
    processSteps: [],
    bodySegments: [],
    status,
    error: typeof message.error === "string" ? message.error : undefined,
    startedAt: now,
    completedAt: status === "streaming" ? undefined : now,
  };

  if (message.type === "thinking" && typeof message.thinking === "string") {
    turn.processSteps.push({
      type: "thinking",
      thinking: {
        id: makeId("thinking"),
        content: message.thinking,
        startedAt: now,
        completedAt: turn.completedAt,
      },
    });
  } else if (message.type === "tool_use") {
    turn.processSteps.push({
      type: "tool",
      tool: {
        id: typeof message.toolUseId === "string" ? message.toolUseId : makeId("tool"),
        name: typeof message.toolName === "string" ? message.toolName : "unknown",
        input: typeof message.toolInput === "string" ? message.toolInput : "",
        result:
          typeof message.toolResult === "string" ? message.toolResult : undefined,
        status:
          message.toolStatus === "done" ||
          message.toolStatus === "error" ||
          message.toolStatus === "running"
            ? message.toolStatus
            : "running",
        startedAt: now,
        completedAt:
          typeof message.toolResult === "string" || message.toolStatus === "done"
            ? now
            : undefined,
      },
    });
  }

  if (typeof message.text === "string" && message.text.length > 0) {
    turn.bodySegments.push({
      id: makeId("segment"),
      text: message.text,
    });
  }

  return createAssistantMessageFromTurn(turn);
}

export async function saveAttachments(
  sessionId: string,
  attachments: FileAttachment[],
  workspaceId = "default"
): Promise<SavedAttachmentMeta[]> {
  await ensureSessionsDir(workspaceId);
  return attachmentResourceModule.save(workspaceId, sessionId, attachments);
}

export async function projectSavedAttachments(
  sessionId: string,
  attachments: readonly PersistedAttachmentRecord[],
  workspaceId = "default"
): Promise<FileAttachment[]> {
  return Promise.all(
    attachments.map(async (record) => {
      const resolved = await attachmentResourceModule.resolve(
        workspaceId,
        sessionId,
        record.attachmentId
      );
      return {
        id: record.attachmentId,
        name: record.filename,
        category: record.category,
        mimeType: record.mimeType,
        size: record.size,
        localPath: resolved.filePath,
      };
    })
  );
}

export async function appendMessageRecord(
  sessionId: string,
  record: MessageRecord,
  workspaceId = "default"
): Promise<void> {
  await runQueuedSessionWrite(
    sessionId,
    workspaceId,
    async () => {
      await ensureSessionsDir(workspaceId);
      await appendFile(
        getJsonlPath(sessionId, workspaceId),
        `${JSON.stringify(record)}\n`,
        "utf8"
      );
    }
  );
}

/**
 * Replaces one durable user message and removes every transcript record after it.
 * Runtime checkpoints are derived state and are invalidated by the session runner
 * before this durable rewrite begins.
 */
export async function reviseUserMessageRecord(
  sessionId: string,
  messageId: string,
  text: string,
  workspaceId = "default"
): Promise<ConversationMessage[]> {
  const targetMessageId = messageId.trim();
  const revisedText = text.trim();

  if (!targetMessageId) {
    throw new Error("Message ID is required.");
  }

  await runQueuedSessionWrite(sessionId, workspaceId, async () => {
    await ensureSessionsDir(workspaceId);

    const transcriptPath = getJsonlPath(sessionId, workspaceId);
    let content: string;
    try {
      content = await readFile(transcriptPath, "utf8");
    } catch (error) {
      if (isEnoentError(error)) {
        throw new Error(`Message ${targetMessageId} not found in session ${sessionId}.`);
      }
      throw error;
    }

    const retainedLines: string[] = [];
    const retainedAttachmentIds = new Set<string>();
    let found = false;

    for (const line of content.split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }

      let record: MessageRecord | { kind: "assistant_block"; message: unknown };
      try {
        record = JSON.parse(line) as MessageRecord | {
          kind: "assistant_block";
          message: unknown;
        };
      } catch {
        throw new Error(`Session ${sessionId} contains an invalid transcript record.`);
      }

      if (record.kind !== "user" || record.message.id !== targetMessageId) {
        retainedLines.push(line);
        if (record.kind === "user") {
          collectSavedAttachmentFileNames(
            record.message.attachments,
            retainedAttachmentIds
          );
        }
        continue;
      }

      if (!revisedText && (!record.message.attachments || record.message.attachments.length === 0)) {
        throw new Error("Message text cannot be empty when there are no attachments.");
      }

      retainedLines.push(
        JSON.stringify({
          kind: "user",
          message: {
            ...record.message,
            text: revisedText || undefined,
            queueState: undefined,
            queueUuid: undefined,
          },
        } satisfies MessageRecord)
      );
      collectSavedAttachmentFileNames(
        record.message.attachments,
        retainedAttachmentIds
      );
      found = true;
      break;
    }

    if (!found) {
      throw new Error(`Message ${targetMessageId} not found in session ${sessionId}.`);
    }

    const revisedContent = retainedLines.length > 0 ? `${retainedLines.join("\n")}\n` : "";
    await replaceFileAtomically(transcriptPath, revisedContent);
    try {
      await attachmentResourceModule.retain(
        workspaceId,
        sessionId,
        retainedAttachmentIds
      );
    } catch (error) {
      await replaceFileAtomically(transcriptPath, content);
      throw error;
    }
  });

  return loadMessages(sessionId, workspaceId);
}

export async function loadMessages(
  sessionId: string,
  workspaceId = "default"
): Promise<ConversationMessage[]> {
  await ensureSessionsDir(workspaceId);

  let content: string;

  try {
    content = await readFile(getJsonlPath(sessionId, workspaceId), "utf8");
  } catch {
    return [];
  }

  const messages: ConversationMessage[] = [];
  let restoredInlineImageCount = 0;

  for (const line of content.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const record = JSON.parse(line) as MessageRecord | {
        kind: "assistant_block";
        message: unknown;
      };

      if (record.kind === "assistant_turn") {
        const turn = normalizeTurn(record.turn);
        if (turn) {
          const lastMessage = messages.at(-1);

          if (lastMessage?.role === "assistant" && lastMessage.turn) {
            messages[messages.length - 1] = {
              ...lastMessage,
              turn: mergeAssistantTurns(lastMessage.turn, turn),
            };
          } else {
            messages.push(createAssistantMessageFromTurn(turn));
          }
        }
        continue;
      }

      if (record.kind === "assistant_block") {
        const legacyMessage = restoreLegacyAssistantBlock(record.message);
        if (legacyMessage) {
          messages.push(legacyMessage);
        }
        continue;
      }

      if (record.kind === "user") {
        const { attachments, ...message } = record.message;
        const restoredMessage: ConversationMessage = {
          id: typeof message.id === "string" ? message.id : makeId("user"),
          role: "user",
          text: typeof message.text === "string" ? message.text : undefined,
          timestamp:
            typeof message.timestamp === "number" ? message.timestamp : Date.now(),
          correction:
            message.correction &&
            typeof message.correction.targetMessageId === "string"
              ? { targetMessageId: message.correction.targetMessageId }
              : undefined,
        };

        if (Array.isArray(attachments) && attachments.length > 0) {
          const restoredAttachments: FileAttachment[] = [];

          for (const meta of attachments) {
            let resolved;
            try {
              resolved = await attachmentResourceModule.resolve(
                workspaceId,
                sessionId,
                meta.attachmentId
              );
            } catch (error) {
              if (
                isEnoentError(error) ||
                (error instanceof Error && error.message === "ATTACHMENT_NOT_FOUND")
              ) {
                continue;
              }
              throw error;
            }
            const filePath = resolved.filePath;

            const restoredAttachment: FileAttachment = {
              id: meta.attachmentId,
              name: meta.filename,
              category: meta.category,
              mimeType: meta.mimeType,
              size: meta.size,
              localPath: filePath,
            };

            if (
              meta.category === "image" &&
              meta.size <= HISTORY_IMAGE_MAX_INLINE_BYTES &&
              restoredInlineImageCount < HISTORY_IMAGE_BASE64_LIMIT
            ) {
              try {
                restoredAttachment.base64Data = (
                  await readFile(filePath)
                ).toString("base64");
                restoredInlineImageCount += 1;
              } catch (error) {
                if (isEnoentError(error)) {
                  continue;
                }

                // Ignore image preview load failures and keep the placeholder state.
              }
            }

            restoredAttachments.push(restoredAttachment);
          }

          if (restoredAttachments.length > 0) {
            restoredMessage.attachments = restoredAttachments;
          }
        }

        messages.push(restoredMessage);
        continue;
      }

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "assistant" || !message.turn) {
          continue;
        }

        if (
          !message.turn.processSteps.some(
            (step) => step.type === "tool" && step.tool.id === record.toolUseId
          )
        ) {
          continue;
        }

        messages[index] = {
          ...message,
          turn: applyToolResultToTurn(
            message.turn,
            record.toolUseId,
            record.result,
            record.isError,
            record.completedAt,
            mergeAssistantActions(
              toAssistantActions(record.assistantActions),
              extractAssistantActionsFromToolResult(record.result)
            )
          ),
        };
        break;
      }
    } catch {
      // Ignore malformed lines so one bad record does not block loading.
    }
  }

  return messages;
}

async function sanitizePersistedToolInput(
  toolName: string,
  input: unknown,
  sessionId: string,
  workspaceId: string
): Promise<unknown> {
  const isReadTool = toolName === "Read";
  const isReadDocumentTool =
    toolName === "read_document" ||
    toolName === "mcp__zora_document__read_document";
  if ((!isReadTool && !isReadDocumentTool) || !isRecord(input)) return input;
  const candidatePath =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : null;
  if (!candidatePath) return input;
  const record = await attachmentResourceModule.findByPath(
    workspaceId,
    sessionId,
    candidatePath
  );
  if (!record) return input;
  const sanitized = { ...input };
  delete sanitized.file_path;
  delete sanitized.path;
  return {
    ...sanitized,
    attachmentId: record.attachmentId,
    fileName: record.filename,
  };
}

export async function persistAssistantMessage(
  sessionId: string,
  sdkMessage: unknown,
  workspaceId = "default"
): Promise<void> {
  const assistantMessage =
    isRecord(sdkMessage) &&
    sdkMessage.type === "assistant" &&
    isRecord(sdkMessage.message)
      ? sdkMessage.message
      : sdkMessage;
  const messageUuid =
    isRecord(sdkMessage) && typeof sdkMessage.uuid === "string"
      ? sdkMessage.uuid
      : undefined;

  if (!isRecord(assistantMessage) || !Array.isArray(assistantMessage.content)) {
    return;
  }

  const startedAt = Date.now();
  const turn: AssistantTurn = {
    id: messageUuid ?? makeId("turn"),
    processSteps: [],
    bodySegments: [],
    status: "done",
    startedAt,
    completedAt: startedAt,
  };

  for (const block of assistantMessage.content) {
    if (!isRecord(block)) {
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      turn.bodySegments.push({
        id: typeof block.id === "string" ? block.id : makeId("segment"),
        text: block.text,
      });
      continue;
    }

    if (block.type === "thinking" && typeof block.thinking === "string") {
      turn.processSteps.push({
        type: "thinking",
        thinking: {
          id: typeof block.id === "string" ? block.id : makeId("thinking"),
          content: block.thinking,
          startedAt,
          completedAt: startedAt,
        },
      });
      continue;
    }

    if (block.type === "tool_use") {
      const toolName = typeof block.name === "string" ? block.name : "unknown";
      turn.processSteps.push({
        type: "tool",
        tool: {
          id: typeof block.id === "string" ? block.id : makeId("tool"),
          name: toolName,
          input: stringifyPersistedValue(
            await sanitizePersistedToolInput(
              toolName,
              block.input,
              sessionId,
              workspaceId
            )
          ),
          status: "running",
          startedAt,
        },
      });
    }
  }

  if (turn.processSteps.length === 0 && turn.bodySegments.length === 0) {
    return;
  }

  await appendMessageRecord(
    sessionId,
    {
      kind: "assistant_turn",
      turn,
    },
    workspaceId
  );
}

export function persistToolResults(
  sessionId: string,
  sdkMessage: unknown,
  workspaceId = "default"
): Promise<void> {
  if (typeof sdkMessage !== "object" || sdkMessage === null) {
    return Promise.resolve();
  }

  const content = (sdkMessage as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return Promise.resolve();
  }

  const writes: Promise<void>[] = [];

  for (const block of content) {
    if (typeof block !== "object" || block === null) {
      continue;
    }

    const item = block as Record<string, unknown>;
    if (item.type !== "tool_result" || typeof item.tool_use_id !== "string") {
      continue;
    }

    const assistantActions = extractAssistantActionsFromToolResult(item.content);

    writes.push(
      appendMessageRecord(sessionId, {
        kind: "tool_result",
        toolUseId: item.tool_use_id,
        result: sanitizeToolResultContent(item.content),
        isError: item.is_error === true,
        completedAt: Date.now(),
        assistantActions:
          assistantActions.length > 0 ? assistantActions : undefined,
      }, workspaceId)
    );
  }

  return Promise.all(writes).then(() => undefined);
}
