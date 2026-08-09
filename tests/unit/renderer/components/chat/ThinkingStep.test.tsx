import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThinkingStep } from "@/renderer/components/chat/ThinkingStep";

describe("ThinkingStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0)
    );
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not move the outer message list when streaming opens automatically", () => {
    const scrollBy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollBy", {
      configurable: true,
      value: scrollBy,
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const isContainer = this.hasAttribute("data-message-scroll-container");
      return {
        x: 0,
        y: 0,
        top: 0,
        right: 400,
        bottom: isContainer ? 100 : 180,
        left: 0,
        width: 400,
        height: isContainer ? 100 : 180,
        toJSON: () => ({}),
      };
    });

    render(
      <div data-message-scroll-container="true">
        <ThinkingStep
          thinking={{ id: "thinking-1", content: "分析中", startedAt: 1 }}
          isStreaming
        />
      </div>
    );

    act(() => {
      vi.runAllTimers();
    });
    expect(scrollBy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /思考/ }));
    fireEvent.click(screen.getByRole("button", { name: /思考/ }));
    act(() => {
      vi.runAllTimers();
    });

    expect(scrollBy).toHaveBeenCalled();
  });
});
