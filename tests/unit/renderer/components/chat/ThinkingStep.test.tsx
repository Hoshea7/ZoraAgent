import { fireEvent, render, screen } from "@testing-library/react";
import { ThinkingStep } from "@/renderer/components/chat/ThinkingStep";

describe("ThinkingStep", () => {
  it("uses a non-underlined keyboard focus treatment", () => {
    render(
      <ThinkingStep
        thinking={{ id: "thinking-focus", content: "分析", startedAt: 1 }}
        isStreaming
      />
    );

    const toggle = screen.getByRole("button", { name: /思考/ });
    expect(toggle).not.toHaveClass("focus-visible:underline");
    expect(toggle).toHaveClass("focus-visible:ring-1");
  });

  it("lets long reasoning expand in the conversation without an inner scroll region", () => {
    const scrollBy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollBy", {
      configurable: true,
      value: scrollBy,
    });

    render(
      <div data-message-scroll-container="true" className="w-40">
        <ThinkingStep
          thinking={{ id: "thinking-1", content: "a".repeat(500), startedAt: 1 }}
          isStreaming
        />
      </div>
    );

    const toggle = screen.getByRole("button", { name: /思考/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const content = screen.getByText("a".repeat(500));
    expect(content).toHaveClass("max-w-full", "[overflow-wrap:anywhere]");
    const detail = screen.getByTestId("thinking-detail");
    expect(detail.closest(".ai-disclosure")).toHaveAttribute(
      "data-disclosure-state",
      "open"
    );
    expect(detail).not.toHaveClass(
      "max-h-[min(52vh,460px)]",
      "overflow-y-auto",
      "overscroll-contain",
      "custom-scrollbar"
    );
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("does not reopen after the user closes it during streaming", () => {
    const { rerender } = render(
      <ThinkingStep
        thinking={{ id: "thinking-1", content: "第一段", startedAt: 1 }}
        isStreaming
      />
    );
    const toggle = screen.getByRole("button", { name: /思考/ });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    rerender(
      <ThinkingStep
        thinking={{ id: "thinking-1", content: "第一段第二段", startedAt: 1 }}
        isStreaming
      />
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    rerender(
      <ThinkingStep
        thinking={{ id: "thinking-1", content: "第一段第二段", startedAt: 1, completedAt: 2 }}
        isStreaming={false}
      />
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the expanded detail mounted while thinking content streams", () => {
    const { rerender } = render(
      <ThinkingStep
        thinking={{ id: "thinking-1", content: "第一段", startedAt: 1 }}
        isStreaming
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /思考/ }));
    const detail = screen.getByTestId("thinking-detail");

    for (let index = 1; index <= 30; index += 1) {
      rerender(
        <ThinkingStep
          thinking={{
            id: "thinking-1",
            content: `第一段\n增量内容 ${index}`,
            startedAt: 1,
          }}
          isStreaming
        />
      );
      expect(screen.getByTestId("thinking-detail")).toBe(detail);
      expect(screen.getByRole("button", { name: /思考/ })).toHaveAttribute(
        "aria-expanded",
        "true"
      );
    }
  });
});
