import { createStore } from "jotai";
import {
  sessionMessagesAtom,
  reviseConversationMessages,
  startConversationAtom,
} from "@/renderer/store/chat";
import { currentSessionIdAtom } from "@/renderer/store/workspace";
import type { ConversationMessage } from "@/shared/zora";

describe("chat message revision", () => {
  it("returns the same user message id that is stored in the conversation", () => {
    const store = createStore();
    const sessionId = "session-stable-user-id";
    store.set(currentSessionIdAtom, sessionId);

    const userMessageId = store.set(startConversationAtom, "Original query");

    expect(store.get(sessionMessagesAtom)[sessionId]?.[0]).toEqual(
      expect.objectContaining({
        id: userMessageId,
        role: "user",
        text: "Original query",
      })
    );
  });

  it("keeps the target user message identity and removes all later UI history", () => {
    const messages: ConversationMessage[] = [
      { id: "user-1", role: "user", text: "First", timestamp: 1 },
      {
        id: "assistant-1",
        role: "assistant",
        timestamp: 2,
        turn: {
          id: "assistant-1",
          processSteps: [],
          bodySegments: [{ id: "body-1", text: "First answer" }],
          status: "done",
          startedAt: 2,
          completedAt: 2,
        },
      },
      { id: "user-2", role: "user", text: "Old query", timestamp: 3 },
      {
        id: "assistant-2",
        role: "assistant",
        timestamp: 4,
        turn: {
          id: "assistant-2",
          processSteps: [],
          bodySegments: [{ id: "body-2", text: "Old answer" }],
          status: "done",
          startedAt: 4,
          completedAt: 4,
        },
      },
      { id: "user-3", role: "user", text: "Later query", timestamp: 5 },
    ];

    const revised = reviseConversationMessages(
      messages,
      "user-2",
      "  Revised query  ",
      10
    );

    expect(revised).toHaveLength(4);
    expect(revised[2]).toEqual({
      id: "user-2",
      role: "user",
      text: "Revised query",
      timestamp: 3,
      queueState: undefined,
      queueUuid: undefined,
    });
    expect(revised[3]).toEqual(
      expect.objectContaining({
        role: "assistant",
        timestamp: 10,
        turn: expect.objectContaining({ status: "streaming", startedAt: 10 }),
      })
    );
    expect(revised.some((message) => message.id === "assistant-2")).toBe(false);
    expect(revised.some((message) => message.id === "user-3")).toBe(false);
  });

  it("returns the original array when the message is not a user message", () => {
    const messages: ConversationMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        timestamp: 1,
        turn: {
          id: "assistant-1",
          processSteps: [],
          bodySegments: [],
          status: "done",
          startedAt: 1,
          completedAt: 1,
        },
      },
    ];

    expect(reviseConversationMessages(messages, "assistant-1", "Changed"))
      .toBe(messages);
  });
});
