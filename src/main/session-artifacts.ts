import path from "node:path";
import { ZORA_DIR } from "./utils/fs";

export function getWorkspaceSessionsDir(workspaceId: string): string {
  return path.join(ZORA_DIR, "workspaces", workspaceId, "sessions");
}

export function getSessionRuntimeRoot(workspaceId: string): string {
  return path.join(getWorkspaceSessionsDir(workspaceId), "runtime");
}

export function getSessionExecutionDir(workspaceId: string, sessionId: string): string {
  return path.join(getSessionRuntimeRoot(workspaceId), "workdirs", sessionId);
}

export function getPiSessionRuntimeDir(
  workspaceId: string,
  sessionId: string
): string {
  return path.join(getSessionRuntimeRoot(workspaceId), "pi", sessionId);
}
