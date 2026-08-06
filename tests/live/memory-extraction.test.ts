import { expect, it, vi } from "vitest";
import { describeLive } from "./helpers/skip-guard";
import { sendLiveQuery } from "./helpers/sdk-harness";
import { createTestZoraHome } from "./helpers/test-zora-home";
import { createCaseReporter } from "./helpers/step-reporter";

async function withTestHome<T>(
  homeDir: string,
  run: () => Promise<T>
): Promise<T> {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  vi.resetModules();

  try {
    return await run();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }

    vi.resetModules();
  }
}

describeLive("Memory Extraction", (provider) => {
  const providerDesc = `${provider.name} (${provider.model || "default"})`;

  it("should extract memory-worthy facts with the real memory-agent prompt", async () => {
    const reporter = createCaseReporter(
      "L3-MEM-002a",
      "记忆提取-耐久事实",
      providerDesc
    );

    try {
      let resultText = "";

      await reporter.step("构建 memory prompt 并调用 SDK", "使用真实 MEMORY_AGENT_SYSTEM_PROMPT", async () => {
        const { MEMORY_AGENT_SYSTEM_PROMPT } = await import("@/main/agent-profiles/memory-profile");
        const conversationHistory = [
          "## Current Memory State",
          "",
          "### MEMORY.md",
          "(empty — not created yet)",
          "",
          "### USER.md",
          "(empty — not created yet)",
          "",
          "## Conversation to Process",
          "",
          "**Session**: Developer preferences",
          "**Date**: 2026-04-23",
          "**Time**: 14:00",
          "",
          "**User**: 我叫张三，是一个前端工程师，平时喜欢用 Vim 和 TypeScript。",
          "",
          "**Zora**: 很高兴认识你张三！前端工程师用 Vim 写 TypeScript，很硬核。",
          "",
          "**User**: 对，我最近在研究 Bun 运行时，觉得比 Node 快很多。",
          "",
          "**Zora**: Bun 确实在性能上有很大优势，特别是启动速度和包管理。",
          "",
          "Please analyze this conversation and update memory files as needed.",
          "If nothing worth remembering happened, just write a brief daily log and finish.",
          "",
          "Before using any tools, summarize the durable facts you found in 3-6 bullet points.",
        ].join("\n");

        const result = await sendLiveQuery(provider, conversationHistory, {
          maxTurns: 1,
          systemPrompt: MEMORY_AGENT_SYSTEM_PROMPT,
        });

        reporter.setInput("conversation: 张三 / 前端工程师 / Vim / TypeScript / Bun");
        reporter.setOutput(`回复: "${result.text.slice(0, 200)}"`);

        expect(result.success).toBe(true);
        expect(result.text.length).toBeGreaterThan(0);

        resultText = result.text;
      });

      await reporter.step("验证提取覆盖", "检查姓名、职业、偏好、工具等关键信息", async () => {
        const text = resultText.toLowerCase();
        const extractedFacts = {
          hasName: text.includes("张三") || text.includes("zhang"),
          hasProfession:
            text.includes("前端") || text.includes("frontend") || text.includes("engineer"),
          hasVim: text.includes("vim"),
          hasTypeScript: text.includes("typescript"),
          hasBun: text.includes("bun"),
        };

        reporter.setInput("检查 durable facts 覆盖项");
        reporter.setOutput(JSON.stringify(extractedFacts));

        const factCount = Object.values(extractedFacts).filter(Boolean).length;
        expect(factCount).toBeGreaterThanOrEqual(3);
      });
    } finally {
      reporter.done();
    }
  });

  it("should write extracted memory into the real memory store", async () => {
    const reporter = createCaseReporter(
      "L3-MEM-002b",
      "记忆提取-落盘到 MEMORY.md",
      providerDesc
    );
    const testHome = createTestZoraHome();

    try {
      let resultText = "";

      await reporter.step("提取 durable fact", "用真实 memory prompt 提取 dark mode 偏好", async () => {
        const { MEMORY_AGENT_SYSTEM_PROMPT } = await import("@/main/agent-profiles/memory-profile");
        const result = await sendLiveQuery(
          provider,
          [
            "## Current Memory State",
            "",
            "### MEMORY.md",
            "(empty — not created yet)",
            "",
            "### USER.md",
            "(empty — not created yet)",
            "",
            "## Conversation to Process",
            "",
            "**Session**: UI preferences",
            "**Date**: 2026-04-23",
            "**Time**: 14:30",
            "",
            "**User**: The user prefers dark mode in all apps.",
            "",
            "Please analyze this conversation and update memory files as needed.",
            "Before using any tools, summarize the most durable fact in one sentence.",
          ].join("\n"),
          {
            maxTurns: 1,
            systemPrompt: MEMORY_AGENT_SYSTEM_PROMPT,
          }
        );

        reporter.setInput("conversation: prefers dark mode");
        reporter.setOutput(`提取结果: "${result.text.slice(0, 160)}"`);

        expect(result.success).toBe(true);
        expect(result.text.length).toBeGreaterThan(0);
        resultText = result.text;
      });

      await reporter.step("写入真实 memory-store", "调用 saveFile/loadFile 落盘并回读", async () => {
        const saved = await withTestHome(testHome.homeDir, async () => {
          const memoryStore = await import("@/main/memory-store");

          await memoryStore.saveFile(
            "MEMORY.md",
            ["# User Memory", "", `- ${resultText.trim()}`, ""].join("\n")
          );

          return memoryStore.loadFile("MEMORY.md");
        });

        reporter.setInput(`HOME=${testHome.homeDir}`);
        reporter.setOutput(`MEMORY.md: "${saved?.slice(0, 160)}"`);

        expect(saved).toContain("# User Memory");
        expect(saved?.length ?? 0).toBeGreaterThan(20);
        expect(saved).toContain(resultText.trim().slice(0, 20));
      });
    } finally {
      reporter.done();
      testHome.cleanup();
    }
  });

  it("should extract memory from a Chinese conversation", async () => {
    const reporter = createCaseReporter(
      "L3-MEM-002c",
      "记忆提取-中文对话",
      providerDesc
    );

    try {
      await reporter.step("发送中文记忆提取请求", "提取字节跳动 / AI 应用开发事实", async () => {
        const result = await sendLiveQuery(
          provider,
          [
            "从下面的中文对话里提取 2-4 条可长期记忆的用户事实。",
            "请用中文回答，每条都用 - 开头，并尽量保留原词“字节跳动”和“AI 应用开发”。",
            "",
            "用户：我在字节跳动工作，主要做 AI 应用开发。",
            "助手：字节跳动的 AI 应用开发，听起来很前沿。",
          ].join("\n"),
          {
            maxTurns: 1,
          }
        );

        const text = result.text;
        const hasBytedance =
          text.includes("字节") || text.includes("ByteDance") || text.includes("bytedance");
        const hasAI =
          text.includes("AI") || text.includes("人工智能") || text.includes("ai");
        const hasWorkContext =
          text.includes("工作") ||
          text.includes("开发") ||
          text.includes("应用") ||
          text.includes("背景");
        const looksStructured =
          text.includes("-") || text.includes("•") || text.split("\n").length > 1;

        reporter.setInput("conversation: 字节跳动 / AI 应用开发");
        reporter.setOutput(`回复: "${result.text.slice(0, 160)}"`);

        expect(result.success).toBe(true);
        expect(result.text.trim().length).toBeGreaterThan(10);
        expect(hasBytedance || hasAI || hasWorkContext || looksStructured).toBe(true);
      });
    } finally {
      reporter.done();
    }
  });
});
