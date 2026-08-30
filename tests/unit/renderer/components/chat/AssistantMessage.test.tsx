import { fireEvent, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ConversationMessage, ProcessStep } from "@/renderer/types";
import {
  draftResponseAnnotationsAtom,
  setDraftResponseAnnotationAtom,
} from "@/renderer/store/chat";
import { requestResponseAnnotationLocation } from "@/renderer/utils/responseAnnotationEvents";

const { markdownRender, elapsedTimerRender } = vi.hoisted(() => ({
  markdownRender: vi.fn(),
  elapsedTimerRender: vi.fn(),
}));

vi.mock("@/renderer/components/chat/MarkdownMessage", () => ({
  MarkdownMessage: (props: { content: string; isStreaming?: boolean }) => {
    markdownRender(props);
    return <div>{props.content}</div>;
  },
  CopyButton: () => null,
}));

vi.mock("@/renderer/components/chat/ElapsedTimer", () => ({
  ElapsedTimer: (props: { startedAt: number }) => {
    elapsedTimerRender(props);
    return <span>运行中</span>;
  },
}));

import { AssistantMessage } from "@/renderer/components/chat/AssistantMessage";

function runningTool(id: string, startedAt: number): ProcessStep {
  return {
    type: "tool",
    tool: {
      id,
      name: "Bash",
      input: "",
      status: "running",
      startedAt,
    },
  };
}

describe("AssistantMessage streaming updates", () => {
  it("renders only the appended tool while keeping stable body and tool rows unchanged", () => {
    const firstTool = runningTool("tool-1", 1);
    const initialMessage: ConversationMessage = {
      id: "assistant-1",
      role: "assistant",
      timestamp: 1,
      turn: {
        id: "turn-1",
        status: "streaming",
        startedAt: 100,
        bodySegments: [{ id: "body-1", text: "已经稳定的正文" }],
        processSteps: [firstTool],
      },
    };
    const updatedMessage: ConversationMessage = {
      ...initialMessage,
      turn: {
        ...initialMessage.turn!,
        processSteps: [...initialMessage.turn!.processSteps, runningTool("tool-2", 2)],
      },
    };
    const store = createStore();
    const { rerender } = render(
      <Provider store={store}>
        <AssistantMessage message={initialMessage} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: /正在使用 Bash/ }));
    markdownRender.mockClear();
    elapsedTimerRender.mockClear();

    rerender(
      <Provider store={store}>
        <AssistantMessage message={updatedMessage} />
      </Provider>
    );

    expect.soft(markdownRender).not.toHaveBeenCalled();
    expect.soft(elapsedTimerRender).toHaveBeenCalledTimes(2);
    expect.soft(elapsedTimerRender.mock.calls.map(([props]) => props.startedAt)).toEqual([
      100,
      2,
    ]);
  });
});

describe("AssistantMessage response annotations", () => {
  it("adds an optional comment from a completed assistant text selection", () => {
    const message: ConversationMessage = {
      id: "assistant-annotation",
      role: "assistant",
      timestamp: 1,
      turn: {
        id: "assistant-annotation",
        status: "done",
        startedAt: 1,
        completedAt: 2,
        bodySegments: [{ id: "body-1", text: "需要额外授权 scope" }],
        processSteps: [],
      },
    };
    const store = createStore();
    render(
      <Provider store={store}>
        <AssistantMessage message={message} />
      </Provider>
    );

    const surface = document.querySelector(
      '[data-response-annotation-surface="assistant-annotation"]'
    ) as HTMLElement;
    const textNode = screen.getByText("需要额外授权 scope").firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(surface);

    fireEvent.click(screen.getByRole("button", { name: "添加批注" }));
    fireEvent.change(screen.getByRole("textbox", { name: "批注评论" }), {
      target: { value: "补充具体权限名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    expect(store.get(draftResponseAnnotationsAtom)).toEqual([
      expect.objectContaining({
        sourceMessageId: "assistant-annotation",
        anchor: expect.objectContaining({ selectedText: "需要额外授权" }),
        comment: "补充具体权限名称",
      }),
    ]);
  });

  it("does not enable annotations while the assistant is streaming", () => {
    const message: ConversationMessage = {
      id: "assistant-streaming",
      role: "assistant",
      timestamp: 1,
      turn: {
        id: "assistant-streaming",
        status: "streaming",
        startedAt: 1,
        bodySegments: [{ id: "body-1", text: "仍在生成" }],
        processSteps: [],
      },
    };
    render(
      <Provider>
        <AssistantMessage message={message} />
      </Provider>
    );

    expect(document.querySelector("[data-response-annotation-surface]")).toBeNull();
  });

  it("deletes an existing annotation from its inline editor", () => {
    const message: ConversationMessage = {
      id: "assistant-delete-annotation",
      role: "assistant",
      timestamp: 1,
      turn: {
        id: "assistant-delete-annotation",
        status: "done",
        startedAt: 1,
        completedAt: 2,
        bodySegments: [{ id: "body-1", text: "删除这条正文批注" }],
        processSteps: [],
      },
    };
    const store = createStore();
    store.set(setDraftResponseAnnotationAtom, {
      id: "annotation-delete",
      sourceMessageId: "assistant-delete-annotation",
      anchor: {
        startOffset: 0,
        endOffset: 2,
        selectedText: "删除",
      },
      comment: "不再需要",
    });
    render(
      <Provider store={store}>
        <AssistantMessage message={message} />
      </Provider>
    );

    fireEvent.click(screen.getByTestId("response-annotation-marker"));

    expect(screen.getByRole("button", { name: "删除批注" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除批注" }));

    expect(store.get(draftResponseAnnotationsAtom)).toEqual([]);
    expect(screen.queryByTestId("response-annotation-marker")).toBeNull();
  });

  it("closes the annotation action immediately on an outside pointer", () => {
    const message: ConversationMessage = {
      id: "assistant-dismiss",
      role: "assistant",
      timestamp: 1,
      turn: {
        id: "assistant-dismiss",
        status: "done",
        startedAt: 1,
        completedAt: 2,
        bodySegments: [{ id: "body-1", text: "点击外部关闭批注入口" }],
        processSteps: [],
      },
    };
    render(
      <Provider>
        <AssistantMessage message={message} />
      </Provider>
    );
    const surface = document.querySelector(
      '[data-response-annotation-surface="assistant-dismiss"]'
    ) as HTMLElement;
    const textNode = screen.getByText("点击外部关闭批注入口").firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(surface);
    expect(screen.getByRole("button", { name: "添加批注" })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(
      screen.queryByRole("button", { name: "添加批注" })
    ).not.toBeInTheDocument();
  });

  it("scrolls the annotation marker into view when locating source text", () => {
    const message: ConversationMessage = {
      id: "assistant-locate",
      role: "assistant",
      timestamp: 1,
      turn: {
        id: "assistant-locate",
        status: "done",
        startedAt: 1,
        completedAt: 2,
        bodySegments: [{ id: "body-1", text: "定位这条批注" }],
        processSteps: [],
      },
    };
    const store = createStore();
    store.set(setDraftResponseAnnotationAtom, {
      id: "annotation-locate",
      sourceMessageId: "assistant-locate",
      anchor: {
        startOffset: 0,
        endOffset: 2,
        selectedText: "定位",
      },
    });
    const scrolledElements: Element[] = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value(this: Element) {
        scrolledElements.push(this);
      },
    });

    render(
      <Provider store={store}>
        <AssistantMessage message={message} />
      </Provider>
    );
    const marker = screen.getByTestId("response-annotation-marker");

    requestResponseAnnotationLocation(
      "assistant-locate",
      "annotation-locate"
    );

    expect(scrolledElements).toEqual([marker]);
  });
});
