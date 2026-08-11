import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContextWindowBadge } from "@/renderer/components/chat/ContextWindowBadge";

describe("ContextWindowBadge", () => {
  it("shows an empty context indicator before the first message", () => {
    render(<ContextWindowBadge />);

    expect(screen.getByLabelText("上下文窗口已使用 0%")).toBeInTheDocument();
  });

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

    expect(screen.getByLabelText("正在压缩上下文")).toBeInTheDocument();
  });

  it("shows usage details and requires confirmation before manual compaction", async () => {
    const onCompact = vi.fn().mockResolvedValue(undefined);
    render(
      <ContextWindowBadge
        state={{
          usedTokens: 146_200,
          contextWindow: 1_000_000,
          thresholdTokens: 800_000,
          status: "ready",
          compactionCount: 0,
          updatedAt: "2026-08-11T10:00:00.000Z",
        }}
        canCompact
        onCompact={onCompact}
      />
    );

    fireEvent.pointerDown(screen.getByLabelText("上下文窗口已使用 15%"), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByText("146.2k / 1.0M")).toBeInTheDocument();
    expect(screen.getByText("占用")).toBeInTheDocument();
    expect(screen.queryByText(/自动压缩/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "手动压缩" }));
    expect(onCompact).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "再次点击确认" }));

    await waitFor(() => expect(onCompact).toHaveBeenCalledOnce());
  });

  it("delegates eligibility checks to the runtime even for a small context", async () => {
    const onCompact = vi.fn().mockResolvedValue(undefined);
    render(
      <ContextWindowBadge
        state={{
          usedTokens: 40_000,
          contextWindow: 1_000_000,
          thresholdTokens: 800_000,
          status: "ready",
          compactionCount: 0,
          updatedAt: "2026-08-12T00:00:00.000Z",
        }}
        canCompact
        onCompact={onCompact}
      />
    );

    fireEvent.pointerDown(screen.getByLabelText("上下文窗口已使用 4%"), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "手动压缩" }));
    fireEvent.click(screen.getByRole("button", { name: "再次点击确认" }));

    await waitFor(() => expect(onCompact).toHaveBeenCalledOnce());
  });
});
