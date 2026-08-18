const RESULT_SUMMARY_CHARACTER_LIMIT = 50_000;

export const EMPTY_COMPLETED_RESULT =
  "子会话已结束，但未找到可用的 assistant 最终回复。请打开子会话查看完整记录。";

export function truncateResultSummary(text: string): {
  resultSummary: string;
  resultTruncated: boolean;
} {
  const normalized = text.trim();
  if (normalized.length <= RESULT_SUMMARY_CHARACTER_LIMIT) {
    return { resultSummary: normalized, resultTruncated: false };
  }
  return {
    resultSummary:
      `${normalized.slice(0, RESULT_SUMMARY_CHARACTER_LIMIT)}\n\n` +
      `[内容过长，已截断 ${
        normalized.length - RESULT_SUMMARY_CHARACTER_LIMIT
      } 字符，请打开子会话查看完整记录。]`,
    resultTruncated: true,
  };
}
