import { PROJECT_DIRECTORY_BUSY } from "../shared/project-directory";

const users = new Map<string, number>();
const rebinding = new Set<string>();
const recoveryPending = new Set<string>();

export function setWorkspaceRecoveryPending(workspaceId: string, pending: boolean): void {
  if (pending) recoveryPending.add(workspaceId);
  else recoveryPending.delete(workspaceId);
}

/** Short mutations and run startup hold a lease; nested leases are allowed. */
export async function useWorkspace<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
  if (rebinding.has(workspaceId) || recoveryPending.has(workspaceId)) throw new Error(PROJECT_DIRECTORY_BUSY);
  users.set(workspaceId, (users.get(workspaceId) ?? 0) + 1);
  try {
    return await operation();
  } finally {
    const remaining = (users.get(workspaceId) ?? 1) - 1;
    if (remaining) users.set(workspaceId, remaining);
    else users.delete(workspaceId);
  }
}

export async function rebindWorkspaceExclusively<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
  if (rebinding.has(workspaceId) || users.has(workspaceId)) throw new Error(PROJECT_DIRECTORY_BUSY);
  rebinding.add(workspaceId);
  try {
    return await operation();
  } finally {
    rebinding.delete(workspaceId);
  }
}
