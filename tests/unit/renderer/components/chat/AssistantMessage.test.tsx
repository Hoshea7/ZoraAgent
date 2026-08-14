import { fireEvent, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ConversationMessage, ProcessStep } from "@/renderer/types";

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
