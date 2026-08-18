import type { AgentStreamEvent, SessionSyncEvent } from "../shared/zora";
import { getSessionMeta, loadMessages } from "./session-store";

interface SessionSyncOptions {
  sessionId: string;
  runId: string;
  workspaceId: string;
  source: SessionSyncEvent["source"];
}

interface EmitSessionSyncOptions extends SessionSyncOptions {
  forwardEvent: (event: AgentStreamEvent) => void;
}

export async function createSessionSyncEvent({
  sessionId,
  runId,
  workspaceId,
  source,
}: SessionSyncOptions): Promise<SessionSyncEvent> {
  const [session, messages] = await Promise.all([
    getSessionMeta(sessionId, workspaceId),
    loadMessages(sessionId, workspaceId),
  ]);

  return {
    type: "session_sync",
    sessionId,
    runId,
    source,
    workspaceId,
    session,
    messages,
  };
}

export async function emitSessionSync({
  sessionId,
  runId,
  workspaceId,
  source,
  forwardEvent,
}: EmitSessionSyncOptions): Promise<void> {
  const event = await createSessionSyncEvent({
    sessionId,
    runId,
    source,
    workspaceId,
  });
  forwardEvent(event);
}
