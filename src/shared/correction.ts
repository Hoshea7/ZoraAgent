export function formatUserCorrection(originalText: string, revisedText: string): string {
  return [
    "[用户修正了此前的消息]",
    `原消息：${originalText}`,
    `修正为：${revisedText}`,
    "请基于修正后的内容继续当前任务。",
  ].join("\n");
}
