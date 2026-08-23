import { expect, it } from "vitest";
import { describeLive } from "./helpers/skip-guard";
import { sendLiveQuery } from "./helpers/sdk-harness";
import { createCaseReporter } from "./helpers/step-reporter";

describeLive("Basic Conversation", (provider) => {
  const providerDesc = `${provider.name} (${provider.model || "default"})`;

  it("should handle factual Q&A", async () => {
    const reporter = createCaseReporter("L3-CHAT-001a", "基础事实问答", providerDesc);

    try {
      await reporter.step("发送事实问题", "问法国首都", async () => {
        const result = await sendLiveQuery(
          provider,
          "What is the capital of France? Reply in one word only.",
          { maxTurns: 1 }
        );

        reporter.setInput("'What is the capital of France?'");
        reporter.setOutput(`回复: "${result.text.slice(0, 100)}"`);

        expect(result.success).toBe(true);
        expect(result.text.toLowerCase()).toContain("paris");
      });
    } finally {
      reporter.done();
    }
  });

  it("should handle Chinese conversation", async () => {
    const reporter = createCaseReporter("L3-CHAT-001b", "中文对话", providerDesc);

    try {
      await reporter.step("发送中文问题", "用中文问 1+1", async () => {
        const result = await sendLiveQuery(
          provider,
          "用中文回答：1加1等于几？只回答数字。",
          { maxTurns: 1 }
        );

        reporter.setInput("'1加1等于几？'");
        reporter.setOutput(`回复: "${result.text.slice(0, 100)}"`);

        expect(result.success).toBe(true);

        const hasTwo = result.text.includes("2") || result.text.includes("二");
        expect(hasTwo).toBe(true);
      });
    } finally {
      reporter.done();
    }
  });

  it("should handle creative request", async () => {
    const reporter = createCaseReporter("L3-CHAT-001c", "创意内容生成", providerDesc);

    try {
      await reporter.step("请求创作 Haiku", "要求写编程主题的 Haiku", async () => {
        const result = await sendLiveQuery(
          provider,
          "Write a haiku about programming. Just the haiku, nothing else.",
          { maxTurns: 1 }
        );

        reporter.setInput("'Write a haiku about programming'");
        reporter.setOutput(`回复: "${result.text.slice(0, 200)}"`);

        expect(result.success).toBe(true);
        expect(result.text.length).toBeGreaterThan(10);
      });
    } finally {
      reporter.done();
    }
  });
});
