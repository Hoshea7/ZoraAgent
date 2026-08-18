import { formatUserCorrection } from "@/shared/correction";

describe("user correction", () => {
  it("preserves the original and revised text in the runtime instruction", () => {
    expect(formatUserCorrection("old value", "new value")).toBe(
      [
        "[用户修正了此前的消息]",
        "原消息：old value",
        "修正为：new value",
        "请基于修正后的内容继续当前任务。",
      ].join("\n")
    );
  });
});
