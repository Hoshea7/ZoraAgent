import { fireEvent, render, screen } from "@testing-library/react";
import { ThinkingStep } from "@/renderer/components/chat/ThinkingStep";

describe("ThinkingStep", () => {
  it("keeps long streamed reasoning inside its container without writing outer scroll state", () => {
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
});
