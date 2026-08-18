import type { AgentStreamEvent, SessionSyncEvent } from "../shared/zora";

interface ProjectionState {
  runId: string;
  events: AgentStreamEvent[];
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

export class SessionTimelinePublisher {
  private readonly projections = new Map<string, ProjectionState>();

  constructor(
    private readonly broadcast: (event: AgentStreamEvent) => void,
    private readonly terminalRetentionMs = 30_000
  ) {}

  publish(sessionId: string, event: AgentStreamEvent): void {
    const scopedEvent = { ...event, sessionId } as AgentStreamEvent;
    if (scopedEvent.type === "session_sync") {
      this.begin(scopedEvent);
      this.broadcast(scopedEvent);
      return;
    }

    if (scopedEvent.runId) {
      const projection = this.projections.get(sessionId);
      if (!projection || projection.runId !== scopedEvent.runId) {
        return;
      }
      projection.events.push(scopedEvent);
      this.scheduleCleanupIfTerminal(sessionId, projection, scopedEvent);
    }
    this.broadcast(scopedEvent);
  }

  replay(
    snapshot: SessionSyncEvent,
    send: (event: AgentStreamEvent) => void
  ): boolean {
    const projection = this.projections.get(snapshot.sessionId);
    if (!projection || projection.runId !== snapshot.runId) return false;
    send(snapshot);
    const persistedMessageIds = new Set(
      snapshot.messages.map((message) => message.id)
    );
    for (const event of projection.events) {
      if (
        event.type === "user_message_committed" &&
        persistedMessageIds.has(event.message.id)
      ) {
        continue;
      }
      send(event);
    }
    return true;
  }

  clear(sessionId: string, runId: string): void {
    const projection = this.projections.get(sessionId);
    if (!projection || projection.runId !== runId) return;
    if (projection.cleanupTimer) clearTimeout(projection.cleanupTimer);
    this.projections.delete(sessionId);
  }

  private begin(snapshot: SessionSyncEvent): void {
    const previous = this.projections.get(snapshot.sessionId);
    if (previous?.cleanupTimer) clearTimeout(previous.cleanupTimer);
    this.projections.set(snapshot.sessionId, {
      runId: snapshot.runId,
      events: [],
    });
  }

  private scheduleCleanupIfTerminal(
    sessionId: string,
    projection: ProjectionState,
    event: AgentStreamEvent
  ): void {
    const terminal =
      event.type === "agent_error" ||
      (event.type === "agent_status" &&
        (event.status === "finished" || event.status === "stopped"));
    if (!terminal) return;
    if (projection.cleanupTimer) clearTimeout(projection.cleanupTimer);
    projection.cleanupTimer = setTimeout(() => {
      if (this.projections.get(sessionId) === projection) {
        this.projections.delete(sessionId);
      }
    }, this.terminalRetentionMs);
  }
}
