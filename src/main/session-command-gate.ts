import { useWorkspace } from "./workspace-operation";
const sessionCommandQueues = new Map<string, Promise<unknown>>();

export async function runSessionCommand<T>(
  sessionId: string,
  workspaceId: string,
  command: () => Promise<T>
): Promise<T> {
  const key = `${workspaceId}\0${sessionId}`;
  const previous = sessionCommandQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => useWorkspace(workspaceId, command));
  sessionCommandQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (sessionCommandQueues.get(key) === current) {
      sessionCommandQueues.delete(key);
    }
  }
}
