import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import {
  runningSessionRunIdsAtom,
  runningSessionsAtom,
  sessionMessagesAtom,
} from "@/renderer/store/chat";
import { currentSessionIdAtom } from "@/renderer/store/workspace";
import { MessageList } from "@/renderer/components/chat/MessageList";
import {
  AGENT_DISCLOSURE_SETTLED_EVENT,
  AGENT_DISCLOSURE_START_EVENT,
} from "@/renderer/utils/scrollAnchor";

function getScrollContainer() {
  return document.querySelector("[data-message-scroll-container='true']") as HTMLElement;
}

function stubScrollMetrics(
  el: HTMLElement,
  scrollHeight = 1_000,
  clientHeight = 400,
  onScrollTopChange?: (value: number) => void
) {
  let scrollTop = 600;
  Object.defineProperties(el, {
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientHeight: { configurable: true, get: () => clientHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
        onScrollTopChange?.(value);
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

  it("keeps automatic follow enabled when an active disclosure adds height", () => {
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
              {
                type: "thinking",
                thinking: { id: "thought", content: "分析", startedAt: 1 },
              },
            ],
          },
        },
      ],
    });
    render(<Provider store={store}><MessageList /></Provider>);

    const outer = getScrollContainer();
    stubScrollMetrics(outer, 2_000, 600);
    fireEvent(outer, new Event(AGENT_DISCLOSURE_START_EVENT));
    fireEvent(outer, new Event(AGENT_DISCLOSURE_SETTLED_EVENT));

    expect(screen.queryByTestId("scroll-to-bottom")).toBeNull();

    outer.scrollTop = 100;
    fireEvent.scroll(outer);
    expect(screen.getByTestId("scroll-to-bottom")).toBeInTheDocument();

    fireEvent(outer, new Event(AGENT_DISCLOSURE_START_EVENT));
    fireEvent(outer, new Event(AGENT_DISCLOSURE_SETTLED_EVENT));
    expect(screen.getByTestId("scroll-to-bottom")).toBeInTheDocument();
  });

  it("keeps the live status directly after process content without sticky positioning", () => {
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
              {
                type: "thinking",
                thinking: { id: "thought", content: "分析", startedAt: 1 },
              },
            ],
          },
        },
      ],
    });
    render(<Provider store={store}><MessageList /></Provider>);

    const outer = getScrollContainer();
    const status = screen.getByTestId("live-turn-status");
    const assistantRow = document.querySelector("[data-streaming-assistant-row='true']");
    const process = assistantRow?.querySelector(".ai-process-content");
    stubScrollMetrics(outer);
    expect(status.previousElementSibling).toBe(process);
    expect(status).toHaveClass("mt-2");
    expect(status.closest("[data-message-scroll-container='true']")).not.toBeNull();
    expect(status).not.toHaveClass("sticky", "bottom-3");
    expect(screen.queryByTestId("live-turn-status-breathing-room")).toBeNull();
    expect(screen.queryByTestId("live-turn-status-layer")).toBeNull();
    expect(screen.queryByTestId("live-turn-status-slot")).toBeNull();

    fireEvent.scroll(outer);
    outer.scrollTop = 599;
    fireEvent.scroll(outer);
    expect(screen.getByTestId("scroll-to-bottom")).toBeInTheDocument();
    expect(screen.getByTestId("live-turn-status")).toBe(status);

    outer.scrollTop = 600;
    fireEvent.scroll(outer);
    expect(screen.queryByTestId("scroll-to-bottom")).toBeNull();
    expect(screen.getByTestId("live-turn-status")).toBe(status);
  });

  it("uses a slightly larger fixed gap after streaming body content", () => {
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
            bodySegments: [{ id: "body-1", text: "正文" }],
            processSteps: [
              {
                type: "thinking",
                thinking: { id: "thought", content: "分析", startedAt: 1 },
              },
            ],
          },
        },
      ],
    });

    render(<Provider store={store}><MessageList /></Provider>);

    const status = screen.getByTestId("live-turn-status");
    const body = document.querySelector("[data-streaming-assistant-body='true']");
    expect(status.previousElementSibling).toBe(body);
    expect(status).toHaveClass("mt-3");
    expect(status).not.toHaveClass("sticky");
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

  it("keeps a newly sent query anchored when the first process output arrives", async () => {
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
    const scrollTopChanges: number[] = [];
    stubScrollMetrics(outer, 2_000, 600, (value) => scrollTopChanges.push(value));
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
    scrollTopChanges.length = 0;
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

    await waitFor(() => expect(outer.scrollTop).toBe(464));
    expect(scrollTopChanges).not.toContain(1_399);
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
    ).toBe(screen.getByTestId("streaming-status-hint"));
    expect(screen.getAllByTestId("live-turn-status")).toHaveLength(1);
    expect(
      screen
        .getByTestId("live-turn-status")
        .querySelector('[data-testid="streaming-status-hint"]')
    ).not.toBeNull();
    expect(screen.queryByTestId("live-turn-status-slot")).toBeNull();
    expect(screen.queryByTestId("live-turn-status-layer")).toBeNull();

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

  it("records the observed run and submits a correction without stopping it", async () => {
    const store = createMessageStore();
    store.set(sessionMessagesAtom, {
      "session-1": [
        { id: "user-1", role: "user", text: "修改这条消息", timestamp: 1 },
      ],
    });
    store.set(runningSessionsAtom, new Set(["session-1"]));
    store.set(runningSessionRunIdsAtom, { "session-1": "run-1" });
    const onReviseMessage = vi.fn().mockResolvedValue(undefined);

    render(
      <Provider store={store}>
        <MessageList
          onReviseMessage={onReviseMessage}
        />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "修正消息" }));

    expect(screen.getByRole("textbox", { name: "编辑消息" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "编辑消息" }), {
      target: { value: "修正后的消息" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(onReviseMessage).toHaveBeenCalledWith(
        "user-1",
        "修正后的消息",
        "correct_active_run",
        "run-1"
      )
    );
  });
});
