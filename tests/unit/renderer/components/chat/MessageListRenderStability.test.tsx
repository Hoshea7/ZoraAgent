import { act, render } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ConversationMessage } from "@/renderer/types";
import { sessionMessagesAtom } from "@/renderer/store/chat";
import { currentSessionIdAtom } from "@/renderer/store/workspace";

const { assistantMessageRender, userMessageRender } = vi.hoisted(() => ({
  assistantMessageRender: vi.fn(),
  userMessageRender: vi.fn(),
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
    return <article data-testid={`assistant-${message.id}`} />;
  },
}));

import { MessageList } from "@/renderer/components/chat/MessageList";

describe("MessageList render stability", () => {
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
