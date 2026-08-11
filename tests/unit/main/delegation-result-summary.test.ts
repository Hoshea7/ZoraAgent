import type { ConversationMessage } from "@/shared/zora";
import {
  EMPTY_COMPLETED_RESULT,
  extractLastAssistantText,
  truncateResultSummary,
} from "@/main/delegation/result-summary";

function assistantMessage(id: string, text: string): ConversationMessage {
  return {
    id,
    role: "assistant",
    timestamp: 1,
    turn: {
      id: `${id}-turn`,
      processSteps: [],
      bodySegments: [{ id: `${id}-body`, text }],
      status: "done",
      startedAt: 1,
      completedAt: 2,
    },
  };
}

describe("delegation result summary", () => {
  it("keeps a fifty-thousand-character final response intact", () => {
    const text = "A".repeat(50_000);
    expect(truncateResultSummary(text)).toEqual({
      resultSummary: text,
      resultTruncated: false,
    });
  });

  it("adds an exact truncation notice after the first fifty thousand characters", () => {
    const text = "B".repeat(50_007);
    expect(truncateResultSummary(text)).toEqual({
      resultSummary:
        `${"B".repeat(50_000)}\n\n` +
        "[内容过长，已截断 7 字符，请打开子会话查看完整记录。]",
      resultTruncated: true,
    });
  });

  it("finds the latest non-empty assistant response", () => {
    const messages: ConversationMessage[] = [
      assistantMessage("first", "first result"),
      { id: "user", role: "user", text: "continue", timestamp: 2 },
      assistantMessage("empty", "   "),
    ];
    expect(extractLastAssistantText(messages)).toBe("first result");
  });

  it("provides an explicit completed result when no assistant response exists", () => {
    expect(EMPTY_COMPLETED_RESULT).toContain("未找到可用的 assistant 最终回复");
  });
});
