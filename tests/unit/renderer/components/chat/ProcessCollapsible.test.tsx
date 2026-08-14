import { fireEvent, render, screen } from "@testing-library/react";
import { ProcessCollapsible } from "@/renderer/components/chat/ProcessCollapsible";

const steps = [
  {
    type: "thinking" as const,
    thinking: { id: "thought", content: "正在核对信息", startedAt: 1 },
  },
];

function getProcessToggle() {
  return screen.getAllByRole("button")[0];
}

describe("ProcessCollapsible", () => {
  it("shows process activity before body content while keeping thinking details collapsed", () => {
    const { rerender } = render(
      <ProcessCollapsible steps={steps} isStreaming turnStartedAt={1} />
    );

    const toggle = getProcessToggle();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("agent-activity")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /思考/ })[1]).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(toggle).not.toHaveClass(
      "focus-visible:ring-2",
      "hover:bg-stone-50/80"
    );
    expect(toggle.querySelector(".animate-trace-summary-in")).toBeNull();
    expect(document.querySelector("[data-agent-activity-scroll='true']")).toBeNull();

    expect(screen.getByText("正在核对信息")).toBeInTheDocument();
    const activity = screen.getByTestId("agent-activity");
    expect(activity).toHaveClass(
      "border-l",
      "border-stone-200/80",
      "pl-3"
    );
    expect(activity).not.toHaveClass(
      "max-h-[min(36vh,320px)]",
      "overflow-y-auto",
      "overscroll-contain",
      "border-l-[1.5px]",
      "before:left-[3.5px]"
    );

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

  it("collapses once when the first body content appears", () => {
    const { rerender } = render(
      <ProcessCollapsible steps={steps} isStreaming turnStartedAt={1} />
    );
    const toggle = getProcessToggle();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

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

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

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
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("respects a manual choice instead of overriding it when body content starts", () => {
    const { rerender } = render(
      <ProcessCollapsible steps={steps} isStreaming turnStartedAt={1} />
    );
    const toggle = getProcessToggle();

    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    rerender(
      <ProcessCollapsible
        steps={steps}
        isStreaming
        bodyStarted
        turnStartedAt={1}
      />
    );
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("does not reopen after the user closes it while process steps continue streaming", () => {
    const { rerender } = render(
      <ProcessCollapsible steps={steps} isStreaming turnStartedAt={1} />
    );
    const toggle = getProcessToggle();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    rerender(
      <ProcessCollapsible
        steps={[
          ...steps,
          {
            type: "tool",
            tool: {
              id: "tool-1",
              name: "Read",
              status: "running",
              startedAt: 2,
            },
          },
        ]}
        isStreaming
        turnStartedAt={1}
      />
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("starts collapsed when body content already exists", () => {
    render(
      <ProcessCollapsible
        steps={steps}
        isStreaming={false}
        bodyStarted
        turnStartedAt={1}
        turnCompletedAt={1001}
      />
    );

    expect(getProcessToggle()).toHaveAttribute("aria-expanded", "false");
  });
});
