import { fireEvent, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ConversationMessage, ProcessStep } from "@/renderer/types";
import { draftResponseAnnotationsAtom } from "@/renderer/store/chat";

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
});
