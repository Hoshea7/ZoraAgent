import type { AgentStreamEvent, SessionSyncEvent } from "../shared/zora";

interface ProjectionState {
  runId: string;
  events: AgentStreamEvent[];
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

/**
 * 已落盘 assistant 快照（uuid 与持久化 turn.id 同源）之后的事件才需要重放。
 * 快照之前的 delta / blockStart / 工具事件都已体现在恢复的全量消息里。
 */
function findAssistantEventIndex(
  events: AgentStreamEvent[],
  anchorUuid: string
): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "assistant" && event.uuid === anchorUuid) {
      return index;
    }
  }
  return -1;
}

/**
 * 锚点命中意味着恢复的最后一个 assistant turn 属于当前 run。
 * 把它重新置为 streaming，重放的事件会继续合并进同一个块，
 * 保持「一次 run 一个助手块」的形态；否则会新建第二个块。
 */
function reactivateLastAssistantTurn(
  snapshot: SessionSyncEvent
): SessionSyncEvent {
  const messages = [...snapshot.messages];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      break;
    }
    if (message.role === "assistant" && message.turn) {
      messages[index] = {
        ...message,
        turn: {
          ...message.turn,
          status: "streaming",
          completedAt: undefined,
        },
      };
      return { ...snapshot, messages };
    }
  }
  return snapshot;
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
    const anchorUuid = snapshot.lastPersistedAssistantTurnId;
    const anchorIndex = anchorUuid
      ? findAssistantEventIndex(projection.events, anchorUuid)
      : -1;
    // 锚点不在当前 run 的事件流里：最后落盘快照属于旧 run，不动快照全量重放。
    const outgoing =
      anchorIndex >= 0 ? reactivateLastAssistantTurn(snapshot) : snapshot;
    send(outgoing);
    const startAt = anchorIndex >= 0 ? anchorIndex + 1 : 0;
    for (const event of projection.events.slice(startAt)) {
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
