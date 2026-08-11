import { render, screen } from "@testing-library/react";
import { ContextWindowBadge } from "@/renderer/components/chat/ContextWindowBadge";

describe("ContextWindowBadge", () => {
  it("shows the current context percentage", () => {
    render(
      <ContextWindowBadge
        state={{
          usedTokens: 80_000,
          contextWindow: 200_000,
          thresholdTokens: 160_000,
          status: "ready",
          compactionCount: 1,
          updatedAt: "2026-08-11T10:00:00.000Z",
        }}
      />
    );

    expect(screen.getByLabelText("上下文窗口已使用 40%")).toBeInTheDocument();
  });

  it("shows compaction as an active state", () => {
    render(
      <ContextWindowBadge
        state={{
          usedTokens: 160_000,
          contextWindow: 200_000,
          thresholdTokens: 160_000,
          status: "compacting",
          compactionCount: 0,
          updatedAt: "2026-08-11T10:00:00.000Z",
        }}
      />
    );

    expect(screen.getByLabelText("正在整理上下文")).toBeInTheDocument();
  });
});
