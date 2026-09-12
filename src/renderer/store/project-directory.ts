import { atom } from "jotai";
import { currentSessionAtom, currentWorkspaceIdAtom, workspacesAtom, loadSessionsAtom } from "./workspace";
import { fileTreeVersionAtom } from "./filetree";

export const workspaceAvailabilityAtom = atom<Record<string, boolean>>({});
const sessionAvailabilityAtom = atom<{ id: string; path: string | undefined; available: boolean } | null>(null);
export const currentDirectoryAvailableAtom = atom((get) => {
  const session = get(currentSessionAtom);
  const checked = get(sessionAvailabilityAtom);
  if (session && checked?.id === session.id && checked.path === session.workingDirectory) return checked.available;
  return get(workspaceAvailabilityAtom)[get(currentWorkspaceIdAtom)] !== false;
});

let refreshVersion = 0;
export const refreshDirectoryAvailabilityAtom = atom(null, async (get, set) => {
  const version = ++refreshVersion;
  const workspaceId = get(currentWorkspaceIdAtom);
  const session = get(currentSessionAtom);
  const [availability, available] = await Promise.all([
    window.zora.getWorkspaceAvailability(),
    session ? window.zora.checkWorkingDirectory(workspaceId, session.id) : Promise.resolve(true),
  ]);
  if (version !== refreshVersion) return;
  set(workspaceAvailabilityAtom, availability);
  set(sessionAvailabilityAtom, session ? { id: session.id, path: session.workingDirectory, available } : null);
});

export const updateWorkspaceAtom = atom(null, async (_get, set, input: { workspaceId: string; name: string; directory: string }) => {
  const updated = await window.zora.updateWorkspace(input.workspaceId, { name: input.name, directory: input.directory });
  set(workspacesAtom, (current) => current.map((workspace) => workspace.id === updated.id ? updated : workspace));
  await set(loadSessionsAtom, input.workspaceId);
  set(fileTreeVersionAtom, (version) => version + 1);
  await set(refreshDirectoryAvailabilityAtom);
});
