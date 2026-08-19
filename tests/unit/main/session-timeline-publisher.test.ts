import { SessionTimelinePublisher } from "@/main/session-timeline-publisher";
import type { AgentStreamEvent, SessionSyncEvent } from "@/shared/zora";

function snapshot(runId: string): SessionSyncEvent {
  return {
    type: "session_sync",
    sessionId: "session-1",
    runId,
    source: "desktop",
    workspaceId: "workspace-1",
    session: null,
    messages: [
      { id: `user-${runId}`, role: "user", text: runId, timestamp: 1 },
    ],
  };
}

function assistantEvent(uuid: string): AgentStreamEvent {
  return {
    type: "assistant",
    sessionId: "session-1",
    runId: "run-1",
    uuid,
    message: {
      role: "assistant",
      content: [{ type: "text", text: `body-${uuid}` }],
    },
  };
}

function textDeltaEvent(): AgentStreamEvent {
  return {
    type: "stream_event",
    sessionId: "session-1",
    runId: "run-1",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "chunk" },
    },
  } as AgentStreamEvent;
}

describe("session timeline publisher", () => {
  it("replays the authoritative snapshot before same-run events", () => {
    const broadcast: AgentStreamEvent[] = [];
    const replay: AgentStreamEvent[] = [];
    const publisher = new SessionTimelinePublisher((event) => broadcast.push(event));
    const sync = snapshot("run-1");
    const started: AgentStreamEvent = {
      type: "agent_status",
      status: "started",
      sessionId: "session-1",
      runId: "run-1",
      source: "desktop",
    };

    publisher.publish("session-1", sync);
    publisher.publish("session-1", started);

    expect(
      publisher.replay(sync, (event) => replay.push(event))
    ).toBe(true);
    expect(replay).toEqual([sync, started]);
    expect(broadcast).toEqual([sync, started]);
  });

  it("replaces the projection on a new run and drops stale run events", () => {
    const broadcast: AgentStreamEvent[] = [];
    const publisher = new SessionTimelinePublisher((event) => broadcast.push(event));
    publisher.publish("session-1", snapshot("run-1"));
    publisher.publish("session-1", snapshot("run-2"));
    publisher.publish("session-1", {
      type: "agent_status",
      status: "finished",
      sessionId: "session-1",
      runId: "run-1",
    });

    const replay: AgentStreamEvent[] = [];
    expect(
      publisher.replay(snapshot("run-1"), vi.fn())
    ).toBe(false);
    expect(
      publisher.replay(snapshot("run-2"), (event) => replay.push(event))
    ).toBe(true);
    expect(replay).toEqual([snapshot("run-2")]);
    expect(broadcast).toEqual([snapshot("run-1"), snapshot("run-2")]);
  });

  it("replays buffered events when nothing has been persisted yet", () => {
    const publisher = new SessionTimelinePublisher(vi.fn());
    publisher.publish("session-1", snapshot("run-1"));
    const started: AgentStreamEvent = {
      type: "agent_status",
      status: "started",
      sessionId: "session-1",
      runId: "run-1",
      source: "desktop",
    };
    publisher.publish("session-1", started);
    const committed: AgentStreamEvent = {
      type: "user_message_committed",
      sessionId: "session-1",
      runId: "run-1",
      message: {
        id: "persisted-later",
        role: "user",
        text: "latest",
        timestamp: 2,
      },
    };
    publisher.publish("session-1", committed);
    const refreshed = {
      ...snapshot("run-1"),
      messages: [
        {
          id: "persisted-later",
          role: "user" as const,
          text: "latest",
          timestamp: 2,
        },
      ],
    };
    const replay: AgentStreamEvent[] = [];

    expect(
      publisher.replay(refreshed, (event) => replay.push(event))
    ).toBe(true);
    // 无 assistant 锚点时全量重放；user_message_committed 由 renderer 按消息 id 幂等合并。
    expect(replay).toEqual([refreshed, started, committed]);
  });

  it("cuts replay at the last persisted assistant snapshot anchor", () => {
    const publisher = new SessionTimelinePublisher(vi.fn());
    publisher.publish("session-1", snapshot("run-1"));

    const started: AgentStreamEvent = {
      type: "agent_status",
      status: "started",
      sessionId: "session-1",
      runId: "run-1",
      source: "desktop",
    };
    publisher.publish("session-1", started);
    publisher.publish("session-1", textDeltaEvent());
    publisher.publish("session-1", assistantEvent("uuid-1"));
    publisher.publish("session-1", textDeltaEvent());
    publisher.publish("session-1", assistantEvent("uuid-2"));

    const pendingPermission: AgentStreamEvent = {
      type: "permission_request",
      sessionId: "session-1",
      runId: "run-1",
      request: { id: "perm-1", description: "run tool" },
    } as AgentStreamEvent;
    publisher.publish("session-1", pendingPermission);

    const synced = {
      ...snapshot("run-1"),
      lastPersistedAssistantTurnId: "uuid-2",
      messages: [
        {
          id: "uuid-2",
          role: "assistant" as const,
          timestamp: 1,
          turn: {
            id: "uuid-2",
            processSteps: [],
            bodySegments: [{ id: "segment-1", text: "body-uuid-2" }],
            status: "done" as const,
            startedAt: 1,
            completedAt: 1,
          },
        },
      ],
    };
    const replay: AgentStreamEvent[] = [];

    expect(
      publisher.replay(synced, (event) => replay.push(event))
    ).toBe(true);
    // 锚点之前的 delta / 快照 / started 都已体现在恢复的全量消息里，不再重放。
    expect(replay).toEqual([replay[0], pendingPermission]);
    // 锚点命中时恢复的 assistant turn 被重新置为 streaming，
    // 重放事件会合并进同一个块而不是新建第二个块。
    const outgoing = replay[0] as typeof synced;
    expect(outgoing.messages[0].turn?.status).toBe("streaming");
    expect(outgoing.messages[0].turn?.completedAt).toBeUndefined();
  });

  it("keeps events after an older anchor including a later snapshot", () => {
    const publisher = new SessionTimelinePublisher(vi.fn());
    publisher.publish("session-1", snapshot("run-1"));
    publisher.publish("session-1", assistantEvent("uuid-1"));
    publisher.publish("session-1", textDeltaEvent());
    publisher.publish("session-1", assistantEvent("uuid-2"));

    const synced = {
      ...snapshot("run-1"),
      lastPersistedAssistantTurnId: "uuid-1",
    };
    const replay: AgentStreamEvent[] = [];

    expect(
      publisher.replay(synced, (event) => replay.push(event))
    ).toBe(true);
    expect(replay).toEqual([synced, textDeltaEvent(), assistantEvent("uuid-2")]);
  });

  it("replays everything when the anchor is missing from the projection", () => {
    const publisher = new SessionTimelinePublisher(vi.fn());
    publisher.publish("session-1", snapshot("run-1"));
    publisher.publish("session-1", assistantEvent("uuid-1"));

    const synced = {
      ...snapshot("run-1"),
      lastPersistedAssistantTurnId: "uuid-not-in-projection",
    };
    const replay: AgentStreamEvent[] = [];

    expect(
      publisher.replay(synced, (event) => replay.push(event))
    ).toBe(true);
    // 找不到锚点时全量重放（多放方向安全，renderer 幂等吸收）。
    expect(replay).toEqual([synced, assistantEvent("uuid-1")]);
  });

  it("still replays in-flight deltas that arrived after the persisted anchor", () => {
    const publisher = new SessionTimelinePublisher(vi.fn());
    publisher.publish("session-1", snapshot("run-1"));
    publisher.publish("session-1", assistantEvent("uuid-1"));
    publisher.publish("session-1", textDeltaEvent());

    const synced = {
      ...snapshot("run-1"),
      lastPersistedAssistantTurnId: "uuid-1",
    };
    const replay: AgentStreamEvent[] = [];

    expect(
      publisher.replay(synced, (event) => replay.push(event))
    ).toBe(true);
    // 持久化慢于广播：锚点之后的 delta 属于未落盘消息，必须重放。
    expect(replay).toEqual([synced, textDeltaEvent()]);
  });
});
