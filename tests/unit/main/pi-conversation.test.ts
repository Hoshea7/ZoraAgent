import { buildPiConversationHistory } from "@/main/runtime/pi-conversation";
import type { PiProviderConfig } from "@/main/runtime/pi-provider-registry";
import type { ConversationMessage } from "@/shared/zora";

const provider: PiProviderConfig = {
  api: "openai-completions",
  baseUrl: "https://example.com/v1",
  apiKey: "sk-test",
  model: "test-model",
  providerId: "provider-1",
};

function assistant(text: string): ConversationMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    timestamp: 2,
    turn: {
      id: "turn-1",
      processSteps: [],
      bodySegments: [{ id: "segment-1", text }],
      status: "done",
      startedAt: 2,
    },
  };
}

describe("buildPiConversationHistory", () => {
  it("projects Zora user and assistant messages into Pi history", () => {
    const history = buildPiConversationHistory(
      [
        { id: "user-1", role: "user", text: "remember alpha", timestamp: 1 },
        assistant("stored alpha"),
        { id: "user-2", role: "user", text: "current question", timestamp: 3 },
      ],
      "current question",
      provider
    );

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: "user", content: "remember alpha" });
    expect(history[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "stored alpha" }],
      model: "test-model",
    });
  });

  it("keeps the last user message when it is not the current prompt", () => {
    const history = buildPiConversationHistory(
      [{ id: "user-1", role: "user", text: "previous question", timestamp: 1 }],
      "new question",
      provider
    );

    expect(history).toEqual([
      { role: "user", content: "previous question", timestamp: 1 },
    ]);
  });

  it("projects historical image attachments into Pi history", () => {
    const history = buildPiConversationHistory(
      [{
        id: "user-1",
        role: "user",
        text: "remember this image",
        timestamp: 1,
        attachments: [{
          id: "image-1",
          name: "photo.png",
          category: "image",
          mimeType: "image/png",
          size: 3,
          localPath: "",
          base64Data: "AQID",
        }],
      }],
      "next question",
      provider
    );

    expect(history).toEqual([{
      role: "user",
      timestamp: 1,
      content: [
        { type: "text", text: "remember this image" },
        { type: "image", data: "AQID", mimeType: "image/png" },
      ],
    }]);
  });

  it("preserves tool-only assistant turns as readable context", () => {
    const history = buildPiConversationHistory(
      [{
        ...assistant(""),
        turn: {
          ...assistant("").turn!,
          processSteps: [{
            type: "tool",
            tool: {
              id: "tool-1",
              name: "Read",
              input: "{}",
              result: "package contents",
              status: "done",
              startedAt: 2,
            },
          }],
        },
      }],
      "next",
      provider
    );

    expect(history[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "[Read]\npackage contents" }],
    });
  });
});
