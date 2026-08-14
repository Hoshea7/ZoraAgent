import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { sessionMessagesAtom } from "@/renderer/store/chat";
import { currentSessionIdAtom } from "@/renderer/store/workspace";

import { MessageList } from "@/renderer/components/chat/MessageList";

/**
 * Helper: create a mock scroll container with controllable scrollHeight / clientHeight.
 * jsdom reports 0 for both, so we stub them to simulate a scrollable area.
 */
function stubScrollMetrics(
  el: HTMLElement,
  scrollHeight: number,
  clientHeight: number
) {
  let scrollTop = 0;
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });
}

function getScrollContainer() {
  return document.querySelector(
    "[data-message-scroll-container='true']"
  ) as HTMLElement;
}

describe("MessageList follow behavior", () => {
  it("auto-scrolls to bottom on mount, stops when user scrolls up, resumes on click", () => {
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

    const scrollEl = getScrollContainer();
    stubScrollMetrics(scrollEl, 1_000, 400);

    // Trigger a re-render so useLayoutEffect runs with the stubbed metrics.
    act(() => {
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
    });

    // After re-render, useLayoutEffect should have scrolled to bottom.
    expect(scrollEl.scrollTop).toBe(1_000);

    // Simulate user scrolling up with wheel.
    fireEvent.wheel(scrollEl, { deltaY: -80 });
    // isAtBottomRef should now be false.
    // scroll-to-bottom button should appear.
    expect(screen.getByTestId("scroll-to-bottom")).toBeTruthy();

    // Add streaming content while user is scrolled away -> should NOT scroll to bottom.
    const scrollTopBefore = scrollEl.scrollTop;
    act(() => {
      store.set(sessionMessagesAtom, {
        "session-1": [
          {
            id: "user-1",
            role: "user",
            text: "测试消息",
            timestamp: 1,
          },
          {
            id: "assistant-1",
            role: "assistant",
            timestamp: 2,
            turn: {
              id: "turn-1",
              processSteps: [],
              bodySegments: [{ id: "seg-1", text: "回复内容" }],
              status: "streaming",
              startedAt: 2,
            },
          },
        ],
      });
    });
    // scrollTop should not have jumped to bottom because user scrolled away.
    expect(scrollEl.scrollTop).toBe(scrollTopBefore);

    // User clicks scroll-to-bottom button.
    fireEvent.click(screen.getByTestId("scroll-to-bottom"));
    expect(scrollEl.scrollTop).toBe(1_000);

    // Now following again - add content and verify it scrolls.
    act(() => {
      store.set(sessionMessagesAtom, {
        "session-1": [
          {
            id: "user-1",
            role: "user",
            text: "测试消息",
            timestamp: 1,
          },
          {
            id: "assistant-1",
            role: "assistant",
            timestamp: 2,
            turn: {
              id: "turn-1",
              processSteps: [],
              bodySegments: [{ id: "seg-1", text: "回复内容更长了" }],
              status: "streaming",
              startedAt: 2,
            },
          },
        ],
      });
    });
    expect(scrollEl.scrollTop).toBe(1_000);
  });

  it("forces follow when a new user message is sent", () => {
    const store = createStore();
    store.set(currentSessionIdAtom, "session-1");
    store.set(sessionMessagesAtom, {
      "session-1": [
        {
          id: "user-1",
          role: "user",
          text: "第一条",
          timestamp: 1,
        },
        {
          id: "assistant-1",
          role: "assistant",
          timestamp: 2,
          turn: {
            id: "turn-1",
            processSteps: [],
            bodySegments: [{ id: "seg-1", text: "回复" }],
            status: "done",
            startedAt: 2,
            completedAt: 3,
          },
        },
      ],
    });

    render(
      <Provider store={store}>
        <MessageList />
      </Provider>
    );

    const scrollEl = getScrollContainer();
    stubScrollMetrics(scrollEl, 1_000, 400);

    // Trigger a re-render so useLayoutEffect runs with the stubbed metrics.
    act(() => {
      store.set(sessionMessagesAtom, {
        "session-1": [
          {
            id: "user-1",
            role: "user",
            text: "第一条",
            timestamp: 1,
          },
          {
            id: "assistant-1",
            role: "assistant",
            timestamp: 2,
            turn: {
              id: "turn-1",
              processSteps: [],
              bodySegments: [{ id: "seg-1", text: "回复" }],
              status: "done",
              startedAt: 2,
              completedAt: 3,
            },
          },
        ],
      });
    });

    // Simulate user scrolled up.
    fireEvent.wheel(scrollEl, { deltaY: -80 });
    expect(screen.getByTestId("scroll-to-bottom")).toBeTruthy();

    // New user message - should force follow (isAtBottomRef = true, button hidden).
    act(() => {
      store.set(sessionMessagesAtom, {
        "session-1": [
          {
            id: "user-1",
            role: "user",
            text: "第一条",
            timestamp: 1,
          },
          {
            id: "assistant-1",
            role: "assistant",
            timestamp: 2,
            turn: {
              id: "turn-1",
              processSteps: [],
              bodySegments: [{ id: "seg-1", text: "回复" }],
              status: "done",
              startedAt: 2,
              completedAt: 3,
            },
          },
          {
            id: "user-2",
            role: "user",
            text: "第二条",
            timestamp: 4,
          },
        ],
      });
    });

    // Should have scrolled to bottom.
    expect(scrollEl.scrollTop).toBe(1_000);
    // Scroll button should be hidden.
    expect(screen.queryByTestId("scroll-to-bottom")).toBeNull();
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
    expect(screen.getAllByTestId("streaming-status-hint")).toHaveLength(1);
  });
});
