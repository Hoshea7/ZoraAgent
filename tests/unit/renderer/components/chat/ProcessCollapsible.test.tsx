import { fireEvent, render, screen } from "@testing-library/react";
import { ProcessCollapsible } from "@/renderer/components/chat/ProcessCollapsible";

const steps = [
  {
    type: "thinking" as const,
    thinking: { id: "thought", content: "正在核对信息", startedAt: 1 },
  },
];

describe("ProcessCollapsible", () => {
  it("starts collapsed and keeps the user's choice across streaming state changes", () => {
    const { rerender } = render(
      <ProcessCollapsible steps={steps} isStreaming turnStartedAt={1} />
    );

    const toggle = screen.getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("[data-agent-activity-scroll='true']")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("正在核对信息")).toBeInTheDocument();

    rerender(
      <ProcessCollapsible
        steps={steps}
        isStreaming={false}
        turnStartedAt={1}
        turnCompletedAt={1001}
      />
    );
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("stays closed while new tokens and completion updates arrive", () => {
    const { rerender } = render(
      <ProcessCollapsible steps={steps} isStreaming turnStartedAt={1} />
    );
    const toggle = screen.getByRole("button");
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    rerender(
      <ProcessCollapsible
        steps={[
          {
            type: "thinking",
            thinking: { id: "thought", content: "正在核对信息，继续分析", startedAt: 1 },
          },
        ]}
        isStreaming
        bodyStarted
        turnStartedAt={1}
      />
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    rerender(
      <ProcessCollapsible
        steps={[
          {
            type: "thinking",
            thinking: {
              id: "thought",
              content: "正在核对信息，继续分析",
              startedAt: 1,
              completedAt: 1001,
            },
          },
        ]}
        isStreaming={false}
        bodyStarted
        turnStartedAt={1}
        turnCompletedAt={1001}
      />
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
