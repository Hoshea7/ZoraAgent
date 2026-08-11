import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { sessionMessagesAtom } from "@/renderer/store/chat";
import { currentSessionIdAtom } from "@/renderer/store/workspace";

const virtuosoHarness = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  scrollTo: vi.fn(),
  scrollToIndex: vi.fn(),
  scrollTopWrites: [] as number[],
}));

vi.mock("react-virtuoso", async () => {
  const React = await import("react");
  return {
    Virtuoso: React.forwardRef(function MockVirtuoso(
      props: Record<string, unknown>,
      ref: React.ForwardedRef<{
        scrollTo: typeof virtuosoHarness.scrollTo;
        scrollToIndex: typeof virtuosoHarness.scrollToIndex;
      }>
    ) {
      const scrollerRef = React.useRef<HTMLDivElement>(null);
      virtuosoHarness.props = props;
      React.useImperativeHandle(ref, () => ({
        scrollTo: virtuosoHarness.scrollTo,
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
      const data = (props.data as unknown[]) ?? [];
      const itemContent = props.itemContent as
        | ((index: number, item: unknown) => React.ReactNode)
        | undefined;
      const Footer = (props.components as { Footer?: React.ComponentType } | undefined)?.Footer;
      return (
        <div ref={scrollerRef} data-testid="virtuoso-scroller">
          <div data-testid="virtuoso-items">
            {data.map((item, index) => (
              <React.Fragment key={index}>{itemContent?.(index, item)}</React.Fragment>
            ))}
            <div data-testid="nested-thinking-scroll" />
          </div>
          <div data-testid="virtuoso-footer">{Footer ? <Footer /> : null}</div>
        </div>
      );
    }),
  };
});

import { MessageList } from "@/renderer/components/chat/MessageList";

describe("MessageList follow behavior", () => {
  beforeEach(() => {
    virtuosoHarness.props = null;
    virtuosoHarness.scrollTo.mockReset();
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
      expect(virtuosoHarness.scrollTo).toHaveBeenCalledWith({
        top: Number.MAX_SAFE_INTEGER,
        behavior: "auto",
      });
    });
    expect(virtuosoHarness.scrollTopWrites).toEqual([]);

    // 思考块内部滚动或没有造成消息列表位移的滚轮事件不能退出实时跟随。
    fireEvent.wheel(screen.getByTestId("nested-thinking-scroll"), { deltaY: -80 });
    expect(props.followOutput(true)).toBe("auto");

    // 键盘滚动同样只在外层列表发生真实位移后退出实时跟随。
    scroller.scrollTop = 800;
    fireEvent.scroll(scroller);
    fireEvent.keyDown(window, { key: "PageUp" });
    scroller.scrollTop = 720;
    fireEvent.scroll(scroller);
    expect(props.followOutput(true)).toBe(false);

    act(() => {
      props.atBottomStateChange(false);
    });
    fireEvent.click(screen.getByTestId("scroll-to-bottom"));
    act(() => {
      props.atBottomStateChange(true);
    });

    // 只有消息列表真实向上移动，才代表用户开始阅读历史内容。
    scroller.scrollTop = 800;
    fireEvent.scroll(scroller);
    fireEvent.wheel(scroller, { deltaY: -80 });
    scroller.scrollTop = 680;
    fireEvent.scroll(scroller);
    expect(props.followOutput(true)).toBe(false);
    scroller.scrollTop = 100;
    virtuosoHarness.scrollTopWrites = [];
    virtuosoHarness.scrollTo.mockClear();
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
    expect(virtuosoHarness.scrollTo).not.toHaveBeenCalled();
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
    expect(virtuosoHarness.scrollTo).toHaveBeenCalledWith({
      top: Number.MAX_SAFE_INTEGER,
      behavior: "auto",
    });
    expect(props.followOutput(true)).toBe("auto");
  });

  it("keeps the active turn status in the footer when a user message is queued", () => {
    const store = createStore();
    store.set(currentSessionIdAtom, "session-1");
    store.set(sessionMessagesAtom, {
      "session-1": [
        {
          id: "assistant-1",
          role: "assistant",
          timestamp: 1,
          turn: {
            id: "turn-1",
            processSteps: [],
            bodySegments: [],
            status: "streaming",
            startedAt: 1,
          },
        },
        {
          id: "user-queued",
          role: "user",
          text: "追加消息",
          queueState: "pending",
          timestamp: 2,
        },
      ],
    });

    render(
      <Provider store={store}>
        <MessageList />
      </Provider>
    );

    const status = screen.getByTestId("streaming-status-hint");
    expect(status).toHaveTextContent("正在思考");
    expect(screen.getByTestId("live-turn-status")).toContainElement(status);
    expect(status.closest('[data-testid="virtuoso-footer"]')).not.toBeNull();
    expect(screen.getAllByTestId("streaming-status-hint")).toHaveLength(1);
  });
});
