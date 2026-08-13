import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentStreamEvent, ContextWindowState } from "../../shared/zora";
import { calculatePiCompactionThresholdTokens } from "./pi-compaction";

function nowIso(): string {
  return new Date().toISOString();
}

export class PiContextTracker {
  private usedTokens = 0;
  private compactionCount = 0;

  constructor(
    private readonly contextWindow: number,
    private readonly maxOutputTokens: number
  ) {}

  observe(event: AgentSessionEvent): AgentStreamEvent | null {
    if (event.type === "message_end" && event.message.role === "assistant") {
      const usage = event.message.usage;
      if (!usage) return null;
      this.usedTokens = usage.totalTokens
        || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
      return this.createEvent("ready");
    }

    if (event.type === "compaction_start") {
      return this.createEvent("compacting");
    }

    if (event.type === "compaction_end") {
      if (event.result && !event.aborted) {
        this.compactionCount += 1;
        if (typeof event.result.estimatedTokensAfter === "number") {
          this.usedTokens = event.result.estimatedTokensAfter;
        }
      }
      return this.createEvent("ready");
    }

    return null;
  }

  private createEvent(status: ContextWindowState["status"]): AgentStreamEvent {
    return {
      type: "context_usage",
      state: {
        usedTokens: this.usedTokens,
        contextWindow: this.contextWindow,
        thresholdTokens: calculatePiCompactionThresholdTokens(
          this.contextWindow,
          this.maxOutputTokens
        ),
        status,
        compactionCount: this.compactionCount,
        updatedAt: nowIso(),
      },
    };
  }
}
