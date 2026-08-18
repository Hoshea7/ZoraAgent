import type { AgentStreamEvent, SessionSyncEvent } from "../shared/zora";
import { getSessionMeta, loadMessages } from "./session-store";

interface EmitSessionSyncOptions {
  sessionId: string;
  runId: string;
  workspaceId: string;
  source: SessionSyncEvent["source"];
  forwardEvent: (event: AgentStreamEvent) => void;
}

export async function emitSessionSync({
  sessionId,
  runId,
  workspaceId,
  source,
  forwardEvent,
}: EmitSessionSyncOptions): Promise<void> {
  const [session, messages] = await Promise.all([
    getSessionMeta(sessionId, workspaceId),
    loadMessages(sessionId, workspaceId),
  ]);

  forwardEvent({
    type: "session_sync",
    sessionId,
    runId,
    source,
    workspaceId,
    session,
    messages,
  });
}
