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
    expect(toggle.closest(".ai-process-content")).toHaveClass("mb-1.5");
    expect(toggle.closest(".ai-process-content")).not.toHaveClass("mb-3");
    expect(screen.getByTestId("agent-activity")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /思考/ })[1]).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(toggle).not.toHaveClass(
      "focus-visible:ring-2",
      "hover:bg-stone-50/80",
      "focus-visible:underline"
    );
    expect(toggle).toHaveClass("focus-visible:ring-1");
    expect(toggle.querySelector(".animate-trace-summary-in")).toBeNull();
    expect(document.querySelector("[data-agent-activity-scroll='true']")).toBeNull();

    expect(screen.getByTitle("正在核对信息")).toBeInTheDocument();
    const activity = screen.getByTestId("agent-activity");
    expect(activity.closest(".ai-disclosure")).toHaveAttribute(
      "data-disclosure-state",
      "open"
    );
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
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(activity.closest(".ai-disclosure")).toHaveAttribute(
      "data-disclosure-state",
      "closed"
    );

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("reveals a newly appended process step without remounting existing rows", () => {
    const { rerender } = render(
      <ProcessCollapsible steps={steps} isStreaming turnStartedAt={1} />
    );
    const firstEntry = screen.getByTestId("process-step-entry-thought");

    rerender(
      <ProcessCollapsible
        steps={[
          ...steps,
          {
            type: "tool",
            tool: {
              id: "tool-new",
              name: "Bash",
              input: "{}",
              status: "running",
              startedAt: 2,
            },
          },
        ]}
        isStreaming
        turnStartedAt={1}
      />
    );

    expect(screen.getByTestId("process-step-entry-thought")).toBe(firstEntry);
    expect(screen.getByTestId("process-step-entry-tool-new")).toHaveClass(
      "animate-trace-step-in",
      "motion-reduce:animate-none"
    );
  });

  it("keeps the disclosure state stable when the first body content appears", () => {
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
    expect(toggle).toHaveAttribute("aria-expanded", "false");
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
