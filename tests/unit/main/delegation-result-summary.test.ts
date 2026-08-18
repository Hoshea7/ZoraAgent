import {
  EMPTY_COMPLETED_RESULT,
  truncateResultSummary,
} from "@/main/delegation/result-summary";

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

  it("provides an explicit completed result when no assistant response exists", () => {
    expect(EMPTY_COMPLETED_RESULT).toContain("未找到可用的 assistant 最终回复");
  });
});
