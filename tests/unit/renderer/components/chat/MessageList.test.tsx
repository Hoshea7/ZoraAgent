import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { sessionMessagesAtom } from "@/renderer/store/chat";
import { currentSessionIdAtom } from "@/renderer/store/workspace";
import { MessageList } from "@/renderer/components/chat/MessageList";

function getScrollContainer() {
  return document.querySelector("[data-message-scroll-container='true']") as HTMLElement;
}

function stubScrollMetrics(el: HTMLElement, scrollHeight = 1_000, clientHeight = 400) {
  let scrollTop = 600;
  Object.defineProperties(el, {
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientHeight: { configurable: true, get: () => clientHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    },
  });
}

function createMessageStore() {
  const store = createStore();
  store.set(currentSessionIdAtom, "session-1");
  return store;
}

describe("MessageList viewport", () => {
  it("detects detachment from an actual outer scroll, including scrollbar dragging", () => {
    const store = createMessageStore();
    store.set(sessionMessagesAtom, {
      "session-1": [{ id: "user-1", role: "user", text: "测试消息", timestamp: 1 }],
    });
    render(<Provider store={store}><MessageList /></Provider>);

    const outer = getScrollContainer();
    stubScrollMetrics(outer);
    outer.scrollTop = 200;
    fireEvent.scroll(outer);

    expect(screen.getByTestId("scroll-to-bottom")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("scroll-to-bottom"));
    expect(screen.queryByTestId("scroll-to-bottom")).toBeNull();
  });

  it("does not detach the conversation when the activity panel scrolls", () => {
    const store = createMessageStore();
    store.set(sessionMessagesAtom, {
      "session-1": [
        {
          id: "assistant-1",
          role: "assistant",
          timestamp: 1,
          turn: {
            id: "turn-1",
            status: "streaming",
            startedAt: 1,
            bodySegments: [],
            processSteps: [
              { type: "thinking", thinking: { id: "thought", content: "分析", startedAt: 1 } },
            ],
          },
        },
      ],
    });
    render(<Provider store={store}><MessageList /></Provider>);
    fireEvent.click(screen.getByRole("button", { name: /思考/ }));

    const inner = document.querySelector("[data-agent-activity-scroll='true']") as HTMLElement;
    fireEvent.scroll(inner);
    expect(screen.queryByTestId("scroll-to-bottom")).toBeNull();
  });

  it("returns to follow mode when a primary user message starts", () => {
    const store = createMessageStore();
    store.set(sessionMessagesAtom, {
      "session-1": [{ id: "user-1", role: "user", text: "第一条", timestamp: 1 }],
    });
    render(<Provider store={store}><MessageList /></Provider>);
    const outer = getScrollContainer();
    stubScrollMetrics(outer);
    outer.scrollTop = 100;
    fireEvent.scroll(outer);
    expect(screen.getByTestId("scroll-to-bottom")).toBeInTheDocument();

    act(() => {
      store.set(sessionMessagesAtom, {
        "session-1": [
          { id: "user-1", role: "user", text: "第一条", timestamp: 1 },
          { id: "user-2", role: "user", text: "第二条", timestamp: 2 },
        ],
      });
    });
    expect(screen.queryByTestId("scroll-to-bottom")).toBeNull();
  });

  it("does not add a duplicate status below an active turn", () => {
    const store = createMessageStore();
    store.set(sessionMessagesAtom, {
      "session-1": [
        {
          id: "assistant-1",
          role: "assistant",
          timestamp: 1,
          turn: { id: "turn-1", processSteps: [], bodySegments: [], status: "streaming", startedAt: 1 },
        },
        { id: "user-queued", role: "user", text: "追加消息", queueState: "pending", timestamp: 2 },
      ],
    });
    render(<Provider store={store}><MessageList /></Provider>);

    expect(screen.queryByText("正在思考")).toBeNull();
    expect(screen.queryByTestId("live-turn-status")).toBeNull();
  });
});
