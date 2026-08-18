import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { SubtaskStatus } from "../../shared/zora";
import { getWorkspaceDataDir } from "../workspace-store";
import { isEnoentError, replaceFileAtomically } from "../utils/fs";

const TERMINAL_STATUSES = new Set<SubtaskStatus>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export interface DelegationResultRecord {
  delegationId: string;
  runId: string;
  status: Exclude<SubtaskStatus, "running">;
  resultSummary?: string;
  resultTruncated: boolean;
  error?: string;
  completedAt: number;
}

const resultOperations = new Map<string, Promise<unknown>>();

function encodePathSegment(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Delegation result identifiers must be non-empty.");
  }
  return encodeURIComponent(normalized);
}

function getDelegationResultDirectory(
  workspaceId: string,
  delegationId: string
): string {
  return path.join(
    getWorkspaceDataDir(workspaceId),
    "delegation-results",
    encodePathSegment(delegationId)
  );
}

function getDelegationResultPath(
  workspaceId: string,
  delegationId: string,
  runId: string
): string {
  return path.join(
    getDelegationResultDirectory(workspaceId, delegationId),
    `${encodePathSegment(runId)}.json`
  );
}

function normalizeRecord(record: DelegationResultRecord): DelegationResultRecord {
  const delegationId = record.delegationId.trim();
  const runId = record.runId.trim();
  if (!delegationId || !runId) {
    throw new Error("Delegation result identifiers must be non-empty.");
  }
  if (!TERMINAL_STATUSES.has(record.status)) {
    throw new Error("Delegation results can only persist terminal statuses.");
  }
  if (!Number.isFinite(record.completedAt) || record.completedAt <= 0) {
    throw new Error("Delegation result completedAt must be a positive timestamp.");
  }
  return {
    delegationId,
    runId,
    status: record.status,
    resultSummary: record.resultSummary,
    resultTruncated: record.resultTruncated,
    error: record.error,
    completedAt: record.completedAt,
  };
}

function parseRecord(value: unknown): DelegationResultRecord {
  if (!value || typeof value !== "object") {
    throw new Error("Delegation result is invalid.");
  }
  const candidate = value as Partial<DelegationResultRecord>;
  if (
    typeof candidate.delegationId !== "string" ||
    typeof candidate.runId !== "string" ||
    typeof candidate.status !== "string" ||
    !TERMINAL_STATUSES.has(candidate.status as SubtaskStatus) ||
    typeof candidate.resultTruncated !== "boolean" ||
    typeof candidate.completedAt !== "number" ||
    (candidate.resultSummary !== undefined &&
      typeof candidate.resultSummary !== "string") ||
    (candidate.error !== undefined && typeof candidate.error !== "string")
  ) {
    throw new Error("Delegation result is invalid.");
  }
  return normalizeRecord(candidate as DelegationResultRecord);
}

async function runResultOperation<T>(
  resultPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = resultOperations.get(resultPath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  resultOperations.set(resultPath, current);
  try {
    return await current;
  } finally {
    if (resultOperations.get(resultPath) === current) {
      resultOperations.delete(resultPath);
    }
  }
}

async function readResultPath(resultPath: string): Promise<DelegationResultRecord | null> {
  try {
    return parseRecord(JSON.parse(await readFile(resultPath, "utf8")));
  } catch (error) {
    if (isEnoentError(error)) return null;
    throw error;
  }
}

export async function putTerminalResult(
  workspaceId: string,
  record: DelegationResultRecord
): Promise<DelegationResultRecord> {
  const normalized = normalizeRecord(record);
  const resultPath = getDelegationResultPath(
    workspaceId,
    normalized.delegationId,
    normalized.runId
  );
  return runResultOperation(resultPath, async () => {
    const existing = await readResultPath(resultPath);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(normalized)) {
        throw new Error(
          `Delegation result conflict for ${normalized.delegationId}/${normalized.runId}.`
        );
      }
      return existing;
    }
    await replaceFileAtomically(
      resultPath,
      `${JSON.stringify(normalized, null, 2)}\n`
    );
    return normalized;
  });
}

export function getResult(
  workspaceId: string,
  delegationId: string,
  runId: string
): Promise<DelegationResultRecord | null> {
  return readResultPath(getDelegationResultPath(workspaceId, delegationId, runId));
}

export async function deleteBySession(
  workspaceId: string,
  delegationId: string
): Promise<void> {
  await rm(getDelegationResultDirectory(workspaceId, delegationId), {
    recursive: true,
    force: true,
  });
}
