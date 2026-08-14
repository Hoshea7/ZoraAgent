import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { runningSessionsAtom, sessionMessagesAtom } from "@/renderer/store/chat";
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
  it("keeps prose readable while giving assistant tables a wider layout container", () => {
    const store = createMessageStore();
    store.set(sessionMessagesAtom, {
      "session-1": [
        { id: "user-1", role: "user", text: "请整理表格", timestamp: 1 },
        {
          id: "assistant-1",
          role: "assistant",
          timestamp: 2,
          turn: {
            id: "turn-1",
            status: "completed",
            startedAt: 1,
            completedAt: 2,
            bodySegments: [
              {
                id: "body-1",
                text: "正文\n\n| 文档 | 来源 | 主要内容 |\n| --- | --- | --- |\n| 会议纪要 | Wiki | 长文本内容 |",
              },
            ],
            processSteps: [],
          },
        },
      ],
    });

    render(<Provider store={store}><MessageList /></Provider>);

    const userRow = document.querySelector('[data-message-id="user-1"]');
    const assistantRow = document.querySelector('[data-message-id="assistant-1"]');
    expect(userRow).toHaveClass("max-w-[920px]");
    expect(assistantRow).toHaveClass("max-w-[1280px]");
    expect(assistantRow?.querySelector("article")).toHaveClass(
      "[container-type:inline-size]"
    );
    expect(assistantRow?.querySelector("article > div")).toHaveClass("max-w-[820px]");
  });

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

  it("keeps Agent activity in the outer conversation scroll flow", () => {
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

    expect(screen.getByTestId("agent-activity")).toBeInTheDocument();
    expect(document.querySelector("[data-agent-activity-scroll='true']")).toBeNull();
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

  it("does not treat an existing query as newly sent when switching sessions", () => {
    const store = createMessageStore();
    store.set(sessionMessagesAtom, {
      "session-1": [{ id: "user-1", role: "user", text: "会话一", timestamp: 1 }],
      "session-2": [{ id: "user-2", role: "user", text: "会话二历史消息", timestamp: 2 }],
    });
    render(<Provider store={store}><MessageList /></Provider>);

    const outer = getScrollContainer();
    stubScrollMetrics(outer, 2_000, 600);
    const offsetTop = vi
      .spyOn(HTMLElement.prototype, "offsetTop", "get")
      .mockImplementation(function () {
        return this.getAttribute("data-message-id") === "user-2" ? 840 : 0;
      });

    act(() => {
      store.set(currentSessionIdAtom, "session-2");
    });

    expect(outer.scrollTop).not.toBe(820);
    offsetTop.mockRestore();
  });

  it("positions a newly sent query near the lower viewport with context above", async () => {
    const store = createMessageStore();
    store.set(sessionMessagesAtom, {
      "session-1": [{ id: "assistant-1", role: "assistant", timestamp: 1, turn: {
        id: "turn-1",
        status: "completed",
        startedAt: 1,
        completedAt: 2,
        bodySegments: [{ id: "body-1", text: "上一轮回复" }],
        processSteps: [],
      } }],
    });
    render(<Provider store={store}><MessageList /></Provider>);

    const outer = getScrollContainer();
    stubScrollMetrics(outer, 2_000, 600);
    const offsetTop = vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function () {
      return this.getAttribute("data-message-id") === "user-2" ? 840 : 0;
    });
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function () {
        return this.getAttribute("data-message-id") === "user-2" ? 64 : 0;
      });

    act(() => {
      store.set(sessionMessagesAtom, {
        "session-1": [
          { id: "assistant-1", role: "assistant", timestamp: 1, turn: {
            id: "turn-1",
            status: "completed",
            startedAt: 1,
            completedAt: 2,
            bodySegments: [{ id: "body-1", text: "上一轮回复" }],
            processSteps: [],
          } },
          { id: "user-2", role: "user", text: "新的 query", timestamp: 2 },
          { id: "assistant-2", role: "assistant", timestamp: 2, turn: {
            id: "turn-2",
            status: "streaming",
            startedAt: 2,
            bodySegments: [],
            processSteps: [],
          } },
        ],
      });
    });

    expect(outer.scrollTop).toBe(464);
    expect(document.querySelector('[data-message-id="assistant-2"]')).not.toHaveClass(
      "min-h-[calc(100vh-250px)]",
      "[content-visibility:auto]",
      "[contain-intrinsic-size:auto_160px]"
    );

    act(() => {
      store.set(sessionMessagesAtom, {
        "session-1": [
          { id: "assistant-1", role: "assistant", timestamp: 1, turn: {
            id: "turn-1",
            status: "completed",
            startedAt: 1,
            completedAt: 2,
            bodySegments: [{ id: "body-1", text: "上一轮回复" }],
            processSteps: [],
          } },
          { id: "user-2", role: "user", text: "新的 query", timestamp: 2 },
          { id: "assistant-2", role: "assistant", timestamp: 2, turn: {
            id: "turn-2",
            status: "streaming",
            startedAt: 2,
            bodySegments: [],
            processSteps: [
              { type: "thinking", thinking: { id: "thought-2", content: "分析", startedAt: 3 } },
            ],
          } },
        ],
      });
    });

    await waitFor(() => expect(outer.scrollTop).toBe(1_399));
    offsetTop.mockRestore();
    offsetHeight.mockRestore();
  });

  it("shows the animated thinking status only after the first stream content arrives", () => {
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

    act(() => {
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
                { type: "thinking", thinking: { id: "thought", content: "分析", startedAt: 2 } },
              ],
            },
          },
          { id: "user-queued", role: "user", text: "追加消息", queueState: "pending", timestamp: 2 },
        ],
      });
    });

    expect(screen.getAllByText("正在思考")).not.toHaveLength(0);
    expect(screen.getByTestId("live-turn-status")).toBeInTheDocument();
    expect(screen.getByTestId("streaming-status-hint")).toBeInTheDocument();
    const assistantRow = document.querySelector('[data-message-id="assistant-1"]');
    expect(
      assistantRow?.querySelector('[data-testid="streaming-status-hint"]')
    ).not.toBeNull();

    act(() => {
      store.set(sessionMessagesAtom, {
        "session-1": [
          {
            id: "assistant-1",
            role: "assistant",
            timestamp: 1,
            turn: {
              id: "turn-1",
              status: "completed",
              startedAt: 1,
              completedAt: 3,
              bodySegments: [{ id: "body", text: "完成" }],
              processSteps: [
                {
                  type: "thinking",
                  thinking: { id: "thought", content: "分析", startedAt: 2, completedAt: 3 },
                },
              ],
            },
          },
          { id: "user-queued", role: "user", text: "追加消息", queueState: "pending", timestamp: 2 },
        ],
      });
    });

    expect(screen.queryByTestId("live-turn-status")).toBeNull();
    expect(screen.queryByTestId("streaming-status-hint")).toBeNull();
  });

  it("stops a running session before opening the message editor", async () => {
    const store = createMessageStore();
    store.set(sessionMessagesAtom, {
      "session-1": [
        { id: "user-1", role: "user", text: "修改这条消息", timestamp: 1 },
      ],
    });
    store.set(runningSessionsAtom, new Set(["session-1"]));
    const onStopForEdit = vi.fn().mockResolvedValue(undefined);

    render(
      <Provider store={store}>
        <MessageList
          onReviseMessage={vi.fn()}
          onStopForEdit={onStopForEdit}
        />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "修改消息" }));

    await waitFor(() => expect(onStopForEdit).toHaveBeenCalledOnce());
    expect(screen.getByRole("textbox", { name: "编辑消息" })).toBeVisible();
  });
});
