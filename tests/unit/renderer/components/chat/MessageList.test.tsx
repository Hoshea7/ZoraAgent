import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { sessionMessagesAtom } from "@/renderer/store/chat";
import { currentSessionIdAtom } from "@/renderer/store/workspace";

const virtuosoHarness = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  scrollToIndex: vi.fn(),
  scrollTopWrites: [] as number[],
}));

vi.mock("react-virtuoso", async () => {
  const React = await import("react");
  return {
    Virtuoso: React.forwardRef(function MockVirtuoso(
      props: Record<string, unknown>,
      ref: React.ForwardedRef<{ scrollToIndex: typeof virtuosoHarness.scrollToIndex }>
    ) {
      const scrollerRef = React.useRef<HTMLDivElement>(null);
      virtuosoHarness.props = props;
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: virtuosoHarness.scrollToIndex,
      }));
      React.useEffect(() => {
        const callback = props.scrollerRef as ((node: HTMLElement | null) => void) | undefined;
        if (scrollerRef.current) {
          let scrollTop = 0;
          Object.defineProperty(scrollerRef.current, "scrollTop", {
            configurable: true,
            get: () => scrollTop,
            set: (value: number) => {
              scrollTop = value;
              virtuosoHarness.scrollTopWrites.push(value);
            },
          });
          Object.defineProperty(scrollerRef.current, "scrollHeight", {
            configurable: true,
            value: 1_000,
          });
        }
        callback?.(scrollerRef.current);
        return () => callback?.(null);
      }, [props.scrollerRef]);
      return <div ref={scrollerRef} data-testid="virtuoso-scroller" />;
    }),
  };
});

import { MessageList } from "@/renderer/components/chat/MessageList";

describe("MessageList follow behavior", () => {
  beforeEach(() => {
    virtuosoHarness.props = null;
    virtuosoHarness.scrollToIndex.mockReset();
    virtuosoHarness.scrollTopWrites = [];
  });

  it("keeps dynamic streaming content at the live edge until the user scrolls away", async () => {
    const store = createStore();
    store.set(currentSessionIdAtom, "session-1");
    store.set(sessionMessagesAtom, {
      "session-1": [
        {
          id: "user-1",
          role: "user",
          text: "测试消息",
          timestamp: 1,
        },
      ],
    });

    render(
      <Provider store={store}>
        <MessageList />
      </Provider>
    );

    const props = virtuosoHarness.props as {
      followOutput: (isAtBottom: boolean) => "auto" | false;
      atBottomStateChange: (atBottom: boolean) => void;
    };
    expect(props.followOutput(true)).toBe("auto");
    expect(props.followOutput(false)).toBe("auto");
    const scroller = screen.getByTestId("virtuoso-scroller");
    await waitFor(() => {
      expect(virtuosoHarness.scrollToIndex).toHaveBeenCalledWith({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    });
    expect(virtuosoHarness.scrollTopWrites).toEqual([]);

    fireEvent.wheel(scroller, { deltaY: -80 });
    expect(props.followOutput(true)).toBe(false);
    scroller.scrollTop = 100;
    virtuosoHarness.scrollTopWrites = [];
    virtuosoHarness.scrollToIndex.mockClear();

    act(() => {
      store.set(sessionMessagesAtom, {
        "session-1": [
          {
            id: "user-1",
            role: "user",
            text: "测试消息继续增长",
            timestamp: 1,
          },
        ],
      });
    });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(scroller.scrollTop).toBe(100);
    expect(virtuosoHarness.scrollTopWrites).toEqual([]);
    expect(virtuosoHarness.scrollToIndex).not.toHaveBeenCalled();

    // 虚拟列表高度重测可能短暂报告触底，不能据此覆盖用户的向上滚动意图。
    act(() => {
      props.atBottomStateChange(true);
    });
    expect(props.followOutput(true)).toBe(false);

    act(() => {
      props.atBottomStateChange(false);
    });
    fireEvent.click(screen.getByTestId("scroll-to-bottom"));
    expect(virtuosoHarness.scrollToIndex).toHaveBeenCalledWith({
      index: "LAST",
      behavior: "auto",
    });
    expect(props.followOutput(true)).toBe("auto");
  });
});
