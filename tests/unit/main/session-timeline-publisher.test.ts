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

    expect(publisher.replay("session-1", "run-1", (event) => replay.push(event)))
      .toBe(true);
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
    expect(publisher.replay("session-1", "run-1", vi.fn())).toBe(false);
    expect(publisher.replay("session-1", "run-2", (event) => replay.push(event)))
      .toBe(true);
    expect(replay).toEqual([snapshot("run-2")]);
    expect(broadcast).toEqual([snapshot("run-1"), snapshot("run-2")]);
  });
});
