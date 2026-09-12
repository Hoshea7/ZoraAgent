import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { currentSessionIdAtom, currentWorkspaceIdAtom, workspacesAtom } from "../store/workspace";
import { refreshDirectoryAvailabilityAtom } from "../store/project-directory";
import { fileTreeVersionAtom } from "../store/filetree";

export function useProjectDirectories(): void {
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const sessionId = useAtomValue(currentSessionIdAtom);
  const workspaces = useAtomValue(workspacesAtom);
  const refresh = useSetAtom(refreshDirectoryAvailabilityAtom);
  const refreshFiles = useSetAtom(fileTreeVersionAtom);
  useEffect(() => {
    const check = () => { void refresh().catch(console.error); };
    const focus = () => { check(); refreshFiles((version) => version + 1); };
    check();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [workspaceId, sessionId, workspaces, refresh, refreshFiles]);
}
