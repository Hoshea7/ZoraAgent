import { findLastPersistedAssistantTurnId } from "@/main/session-sync";
import type { ConversationMessage } from "@/shared/zora";

function userMessage(id: string): ConversationMessage {
  return { id, role: "user", text: "hi", timestamp: 1 };
}

function assistantMessage(turnId: string): ConversationMessage {
  return {
    id: turnId,
    role: "assistant",
    timestamp: 1,
    turn: {
      id: turnId,
      processSteps: [],
      bodySegments: [{ id: "segment-1", text: "body" }],
      status: "done",
      startedAt: 1,
      completedAt: 1,
    },
  };
}

describe("findLastPersistedAssistantTurnId", () => {
  it("returns the id of the last assistant message", () => {
    const messages = [
      userMessage("user-1"),
      assistantMessage("uuid-1"),
      assistantMessage("uuid-2"),
    ];

    expect(findLastPersistedAssistantTurnId(messages)).toBe("uuid-2");
  });

  it("skips trailing user messages such as queued prompts", () => {
    const messages = [
      assistantMessage("uuid-1"),
      userMessage("user-2"),
    ];

    expect(findLastPersistedAssistantTurnId(messages)).toBe("uuid-1");
  });

  it("returns undefined when no assistant message exists", () => {
    expect(findLastPersistedAssistantTurnId([userMessage("user-1")])).toBeUndefined();
    expect(findLastPersistedAssistantTurnId([])).toBeUndefined();
  });

  it("ignores assistant messages without a turn payload", () => {
    const legacy: ConversationMessage = {
      id: "legacy-1",
      role: "assistant",
      text: "legacy body",
      timestamp: 1,
    };
    const messages = [legacy, assistantMessage("uuid-1")];

    expect(findLastPersistedAssistantTurnId(messages)).toBe("uuid-1");
    expect(findLastPersistedAssistantTurnId([legacy])).toBeUndefined();
  });
});
