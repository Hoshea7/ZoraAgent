import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { PiContextTracker } from "@/main/runtime/pi-context-tracker";

describe("PiContextTracker", () => {
  it("reports provider usage against the compaction threshold", () => {
    const tracker = new PiContextTracker(200_000);
    const event = tracker.observe({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "stop",
        usage: {
          input: 100_000,
          output: 2_000,
          cacheRead: 10_000,
          cacheWrite: 0,
          totalTokens: 112_000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    } as AgentSessionEvent);

    expect(event).toMatchObject({
      type: "context_usage",
      state: {
        usedTokens: 112_000,
        contextWindow: 200_000,
        thresholdTokens: 160_000,
        status: "ready",
        compactionCount: 0,
      },
    });
  });

  it("tracks compaction without marking the Agent Turn complete", () => {
    const tracker = new PiContextTracker(100_000);

    expect(tracker.observe({ type: "compaction_start", reason: "threshold" })).toMatchObject({
      state: { status: "compacting", compactionCount: 0 },
    });
    expect(
      tracker.observe({
        type: "compaction_end",
        reason: "threshold",
        result: {
          summary: "summary",
          firstKeptEntryId: "entry-1",
          tokensBefore: 81_000,
          estimatedTokensAfter: 22_000,
        },
        aborted: false,
        willRetry: false,
      })
    ).toMatchObject({
      state: {
        usedTokens: 22_000,
        status: "ready",
        compactionCount: 1,
      },
    });
  });
});
