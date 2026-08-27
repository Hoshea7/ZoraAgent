import { act, fireEvent, render } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ConversationMessage } from "@/renderer/types";
import { sessionMessagesAtom } from "@/renderer/store/chat";
import { currentSessionIdAtom } from "@/renderer/store/workspace";

const {
  assistantMessageRender,
  contentRef,
  scrollRef,
  scrollToBottom,
  stickOptions,
  stopScroll,
  userMessageRender,
} = vi.hoisted(() => {
  const scrollRef = Object.assign(
    (node: HTMLElement | null) => {
      scrollRef.current = node;
    },
    { current: null as HTMLElement | null }
  );
  const contentRef = Object.assign(
    (node: HTMLElement | null) => {
      contentRef.current = node;
    },
    { current: null as HTMLElement | null }
  );
  return {
    assistantMessageRender: vi.fn(),
    contentRef,
    scrollRef,
    scrollToBottom: vi.fn(() => true),
    stickOptions: { current: undefined as Record<string, unknown> | undefined },
    stopScroll: vi.fn(),
    userMessageRender: vi.fn(),
  };
});

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottom: (options: Record<string, unknown>) => {
    stickOptions.current = options;
    return {
      contentRef,
      scrollRef,
      scrollToBottom,
      stopScroll,
      isAtBottom: true,
      isNearBottom: true,
      escapedFromLock: false,
      state: {},
    };
  },
}));

vi.mock("@/renderer/components/chat/UserMessage", () => ({
  UserMessage: ({ message }: { message: ConversationMessage }) => {
    userMessageRender(message.id);
    return <article data-testid={`user-${message.id}`} />;
  },
}));

vi.mock("@/renderer/components/chat/AssistantMessage", () => ({
  AssistantMessage: ({ message }: { message: ConversationMessage }) => {
    assistantMessageRender(message.id);
    return (
      <article data-testid={`assistant-${message.id}`}>
        {message.turn?.status === "streaming" ? (
          <>
            <div className="ai-process-content" />
            <div data-streaming-assistant-body="true" />
          </>
        ) : null}
      </article>
    );
  },
}));

import { MessageList } from "@/renderer/components/chat/MessageList";

describe("MessageList render stability", () => {
  beforeEach(() => {
    assistantMessageRender.mockClear();
    scrollToBottom.mockClear();
    stopScroll.mockClear();
    userMessageRender.mockClear();
    stickOptions.current = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the streaming resize observers stable across thinking and tool deltas", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    const observeMutations = vi.fn();
    const disconnectMutations = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe = observe;
        disconnect = disconnect;
      }
    );
    vi.stubGlobal(
      "MutationObserver",
      class MutationObserver {
        observe = observeMutations;
        disconnect = disconnectMutations;
      }
    );

    const store = createStore();
    const userMessage: ConversationMessage = {
      id: "user-1",
      role: "user",
      text: "检查流式滚动稳定性",
      timestamp: 1,
    };
    const assistantMessage: ConversationMessage = {
      id: "assistant-1",
      role: "assistant",
      timestamp: 2,
      turn: {
        id: "turn-1",
        status: "streaming",
        startedAt: 2,
        bodySegments: [],
        processSteps: [
          {
            type: "thinking",
            thinking: { id: "thinking-1", content: "分析", startedAt: 2 },
          },
        ],
      },
    };
    store.set(currentSessionIdAtom, "session-1");
    store.set(sessionMessagesAtom, {
      "session-1": [userMessage, assistantMessage],
    });

    render(
      <Provider store={store}>
        <MessageList />
      </Provider>
    );
    const initialObserveCount = observe.mock.calls.length;
    const initialMutationObserveCount = observeMutations.mock.calls.length;
    for (let index = 1; index <= 30; index += 1) {
      act(() => {
        store.set(sessionMessagesAtom, {
          "session-1": [
            userMessage,
            {
              ...assistantMessage,
              turn: {
                ...assistantMessage.turn!,
                processSteps: [
                  {
                    type: "thinking",
                    thinking: {
                      id: "thinking-1",
                      content: `分析组件更新 ${index}`,
                      startedAt: 2,
                    },
                  },
                ],
              },
            },
          ],
        });
      });
    }

    for (let index = 1; index <= 30; index += 1) {
      act(() => {
        store.set(sessionMessagesAtom, {
          "session-1": [
            userMessage,
            {
              ...assistantMessage,
              turn: {
                ...assistantMessage.turn!,
                processSteps: [
                  assistantMessage.turn!.processSteps[0],
                  {
                    type: "tool",
                    tool: {
                      id: "tool-1",
                      name: "Bash",
                      input: `步骤 ${index}`,
                      status: "running",
                      startedAt: 2,
                    },
                  },
                ],
              },
            },
          ],
        });
      });
    }

    expect(initialObserveCount).toBeGreaterThan(0);
    expect(initialMutationObserveCount).toBeGreaterThan(0);
    expect({
      observeCount: observe.mock.calls.length,
      disconnectCount: disconnect.mock.calls.length,
    }).toEqual({
      observeCount: initialObserveCount,
      disconnectCount: 0,
    });
    expect({
      observeCount: observeMutations.mock.calls.length,
      disconnectCount: disconnectMutations.mock.calls.length,
    }).toEqual({
      observeCount: initialMutationObserveCount,
      disconnectCount: 0,
    });
  });

  it("anchors the body immediately for process growth and springs with body growth", () => {
    const resizeCallbacks: ResizeObserverCallback[] = [];
    const mutationCallbacks: MutationCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal(
      "MutationObserver",
      class MutationObserver {
        constructor(callback: MutationCallback) {
          mutationCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      }
    );

    let scrollHeight = 1_000;
    let scrollTop = 300;
    let processHeight = 40;
    let bodyHeight = 40;
    const directScrollAssignments: number[] = [];
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight"
    );
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight"
    );
    const scrollTopDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollTop"
    );
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function () {
        return {
          height:
            this.getAttribute("data-streaming-assistant-body") === "true"
              ? bodyHeight
              : this.classList.contains("ai-process-content")
                ? processHeight
                : 0,
        } as DOMRect;
      });
    Object.defineProperties(HTMLElement.prototype, {
      scrollHeight: {
        configurable: true,
        get() {
          return this.getAttribute("data-message-scroll-container") === "true"
            ? scrollHeight
            : 0;
        },
      },
      clientHeight: {
        configurable: true,
        get() {
          return this.getAttribute("data-message-scroll-container") === "true"
            ? 400
            : 0;
        },
      },
      scrollTop: {
        configurable: true,
        get() {
          return this.getAttribute("data-message-scroll-container") === "true"
            ? scrollTop
            : 0;
        },
        set(value: number) {
          if (this.getAttribute("data-message-scroll-container") === "true") {
            scrollTop = value;
            directScrollAssignments.push(value);
          }
        },
      },
    });

    const store = createStore();
    store.set(currentSessionIdAtom, "session-1");
    store.set(sessionMessagesAtom, {
      "session-1": [
        {
          id: "assistant-1",
          role: "assistant",
          timestamp: 2,
          turn: {
            id: "turn-1",
            status: "streaming",
            startedAt: 2,
            bodySegments: [{ id: "body-1", text: "正文" }],
            processSteps: [],
          },
        },
      ],
    });

    render(
      <Provider store={store}>
        <MessageList />
      </Provider>
    );

    expect(resizeCallbacks).toHaveLength(1);
    expect(mutationCallbacks).toHaveLength(1);
    scrollHeight = 1_024;
    processHeight = 64;
    mutationCallbacks[0]([], {} as MutationObserver);

    expect(directScrollAssignments).toEqual([324]);
    expect(scrollToBottom).not.toHaveBeenCalled();
    const targetScrollTop = stickOptions.current?.targetScrollTop as
      | ((target: number) => number)
      | undefined;
    expect(targetScrollTop?.(624)).toBe(324);

    scrollToBottom.mockClear();
    scrollHeight = 1_048;
    bodyHeight = 64;
    resizeCallbacks[0]([], {} as ResizeObserver);

    expect(directScrollAssignments).toEqual([324]);
    expect(scrollToBottom).toHaveBeenCalledWith(
      expect.objectContaining({
        animation: expect.objectContaining({ damping: expect.any(Number) }),
        ignoreEscapes: false,
        wait: true,
      })
    );
    expect(targetScrollTop?.(648)).toBe(348);

    rectSpy.mockRestore();
    if (scrollHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
    }
    if (clientHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
    }
    if (scrollTopDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollTop", scrollTopDescriptor);
    }
  });

  it("rebases the streaming target when the user returns to the latest content", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        disconnect() {}
      }
    );

    let scrollTop = 600;
    const store = createStore();
    store.set(currentSessionIdAtom, "session-1");
    store.set(sessionMessagesAtom, {
      "session-1": [
        {
          id: "assistant-previous",
          role: "assistant",
          timestamp: 1,
          turn: {
            id: "turn-previous",
            status: "completed",
            startedAt: 1,
            completedAt: 2,
            bodySegments: [{ id: "body-previous", text: "上一轮" }],
            processSteps: [],
          },
        },
      ],
    });

    render(
      <Provider store={store}>
        <MessageList />
      </Provider>
    );

    const outer = scrollRef.current!;
    Object.defineProperties(outer, {
      scrollHeight: { configurable: true, get: () => 2_000 },
      clientHeight: { configurable: true, get: () => 600 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    const offsetTop = vi
      .spyOn(HTMLElement.prototype, "offsetTop", "get")
      .mockImplementation(function () {
        return this.getAttribute("data-message-id") === "user-current" ? 840 : 0;
      });
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function () {
        return this.getAttribute("data-message-id") === "user-current" ? 64 : 0;
      });

    act(() => {
      store.set(sessionMessagesAtom, {
        "session-1": [
          {
            id: "assistant-previous",
            role: "assistant",
            timestamp: 1,
            turn: {
              id: "turn-previous",
              status: "completed",
              startedAt: 1,
              completedAt: 2,
              bodySegments: [{ id: "body-previous", text: "上一轮" }],
              processSteps: [],
            },
          },
          { id: "user-current", role: "user", text: "继续", timestamp: 3 },
          {
            id: "assistant-current",
            role: "assistant",
            timestamp: 4,
            turn: {
              id: "turn-current",
              status: "streaming",
              startedAt: 4,
              bodySegments: [],
              processSteps: [],
            },
          },
        ],
      });
    });

    expect(scrollTop).toBe(464);
    await act(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        })
    );
    scrollTop = 1_400;
    fireEvent.scroll(outer);

    const targetScrollTop = stickOptions.current?.targetScrollTop as
      | ((target: number) => number)
      | undefined;
    expect(targetScrollTop?.(1_399)).toBe(1_399);

    offsetTop.mockRestore();
    offsetHeight.mockRestore();
  });

  it("does not rerender historical user cards for thinking deltas", () => {
    const store = createStore();
    const userMessage: ConversationMessage = {
      id: "user-1",
      role: "user",
      text: "检查 UI 稳定性",
      timestamp: 1,
    };
    const assistantMessage: ConversationMessage = {
      id: "assistant-1",
      role: "assistant",
      timestamp: 2,
      turn: {
        id: "turn-1",
        status: "streaming",
        startedAt: 2,
        bodySegments: [],
        processSteps: [
          {
            type: "thinking",
            thinking: { id: "thinking-1", content: "分析", startedAt: 2 },
          },
        ],
      },
    };
    store.set(currentSessionIdAtom, "session-1");
    store.set(sessionMessagesAtom, {
      "session-1": [userMessage, assistantMessage],
    });

    render(
      <Provider store={store}>
        <MessageList onReviseMessage={vi.fn()} />
      </Provider>
    );
    expect(userMessageRender).toHaveBeenCalledTimes(1);
    expect(assistantMessageRender).toHaveBeenCalledTimes(1);

    for (let index = 1; index <= 60; index += 1) {
      act(() => {
        store.set(sessionMessagesAtom, {
          "session-1": [
            userMessage,
            {
              ...assistantMessage,
              turn: {
                ...assistantMessage.turn!,
                processSteps: [
                  {
                    type: "thinking",
                    thinking: {
                      id: "thinking-1",
                      content: `分析组件更新 ${index}`,
                      startedAt: 2,
                    },
                  },
                ],
              },
            },
          ],
        });
      });
    }

    expect(assistantMessageRender).toHaveBeenCalledTimes(61);
    expect(userMessageRender).toHaveBeenCalledTimes(1);
  });
});
