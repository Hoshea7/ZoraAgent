import { expect, it } from "vitest";
import { describeLive } from "./helpers/skip-guard";
import {
  sendLiveConversation,
  sendLiveQuery,
  type ConversationMessage,
} from "./helpers/sdk-harness";
import { createCaseReporter } from "./helpers/step-reporter";

const CONTEXT_SYSTEM_PROMPT =
  "Answer strictly from the provided conversation history. " +
  "Do not say you need to check memory, files, or tools. " +
  "If the answer is present in the history, answer it directly and concisely.";

describeLive("Multi-turn Conversation", (provider) => {
  const providerDesc = `${provider.name} (${provider.model || "default"})`;

  it("should remember user name across turns", async () => {
    const reporter = createCaseReporter("L3-CHAT-002a", "多轮对话-记忆名字", providerDesc);
    const firstPrompt =
      "Hi, my name is TestUser42. Please remember my name and confirm.";

    try {
      let turn1Text = "";

      await reporter.step("第一轮：用户自我介绍", "发送包含名字的消息", async () => {
        const result = await sendLiveQuery(provider, firstPrompt, {
          maxTurns: 1,
        });

        expect(result.success).toBe(true);
        turn1Text = result.text;
        reporter.setInput("'my name is TestUser42'");
        reporter.setOutput(`回复: "${turn1Text.slice(0, 150)}"`);
      });

      await reporter.step("第二轮：带上下文询问名字", "携带历史，问'我叫什么'", async () => {
        const history: ConversationMessage[] = [
          { role: "user", content: firstPrompt },
          { role: "assistant", content: turn1Text },
        ];

        let result = await sendLiveConversation(
          provider,
          history,
          "What is my name? Reply with just the name, nothing else.",
          {
            systemPrompt: CONTEXT_SYSTEM_PROMPT,
          }
        );

        if (!result.text.includes("TestUser42")) {
          result = await sendLiveConversation(
            provider,
            history,
            "Based only on the conversation above, what is my exact name? Answer with the exact token only.",
            {
              systemPrompt: CONTEXT_SYSTEM_PROMPT,
            }
          );
        }

        reporter.setInput("history: 1 轮 + 新问题 'What is my name?'");
        reporter.setOutput(`回复: "${result.text.slice(0, 100)}"`);

        expect(result.success).toBe(true);
        expect(result.text).toContain("TestUser42");
      });
    } finally {
      reporter.done();
    }
  });

  it("should handle three-turn conversation with accumulating context", async () => {
    const reporter = createCaseReporter("L3-CHAT-002b", "多轮对话-三轮累积", providerDesc);
    const prompt1 = "I have a cat named Pixel. Confirm you noted this.";

    try {
      let turn1Text = "";
      let turn2Text = "";

      await reporter.step("第一轮：宠物 A", "告知有猫叫 Pixel", async () => {
        const result = await sendLiveQuery(provider, prompt1, {
          maxTurns: 1,
        });

        expect(result.success).toBe(true);
        turn1Text = result.text;
        reporter.setInput("'cat named Pixel'");
        reporter.setOutput(`确认: "${turn1Text.slice(0, 100)}"`);
      });

      const prompt2 = "I also have a dog named Byte. Confirm you noted both pets.";
      await reporter.step("第二轮：宠物 B", "告知有狗叫 Byte", async () => {
        const history: ConversationMessage[] = [
          { role: "user", content: prompt1 },
          { role: "assistant", content: turn1Text },
        ];
        const result = await sendLiveConversation(provider, history, prompt2, {
          systemPrompt: CONTEXT_SYSTEM_PROMPT,
        });

        expect(result.success).toBe(true);
        turn2Text = result.text;
        reporter.setInput("history: 1 轮 + 'dog named Byte'");
        reporter.setOutput(`确认: "${turn2Text.slice(0, 100)}"`);
      });

      await reporter.step("第三轮：验证累积", "要求列出所有宠物", async () => {
        const history: ConversationMessage[] = [
          { role: "user", content: "I have a cat named Pixel." },
          { role: "assistant", content: turn1Text },
          { role: "user", content: "I also have a dog named Byte." },
          { role: "assistant", content: turn2Text },
        ];
        const result = await sendLiveConversation(
          provider,
          history,
          "List all my pets and their names. Be concise.",
          {
            systemPrompt: CONTEXT_SYSTEM_PROMPT,
          }
        );

        const text = result.text.toLowerCase();
        reporter.setInput("history: 2 轮 + 'List all my pets'");
        reporter.setOutput(`回复: "${result.text.slice(0, 200)}"`);

        expect(result.success).toBe(true);
        expect(text).toContain("pixel");
        expect(text).toContain("byte");
      });
    } finally {
      reporter.done();
    }
  });

  it("should handle multi-turn in Chinese", async () => {
    const reporter = createCaseReporter("L3-CHAT-002c", "多轮对话-中文上下文", providerDesc);
    const firstPrompt = "我最喜欢的编程语言是 TypeScript。请确认。";

    try {
      let turn1Text = "";

      await reporter.step("第一轮：告知偏好", "说喜欢 TypeScript", async () => {
        const result = await sendLiveQuery(provider, firstPrompt, {
          maxTurns: 1,
        });

        expect(result.success).toBe(true);
        turn1Text = result.text;
        reporter.setInput("'最喜欢 TypeScript'");
        reporter.setOutput(`确认: "${turn1Text.slice(0, 100)}"`);
      });

      await reporter.step("第二轮：回忆偏好", "问最喜欢的语言", async () => {
        const history: ConversationMessage[] = [
          { role: "user", content: firstPrompt },
          { role: "assistant", content: turn1Text },
        ];

        const result = await sendLiveConversation(
          provider,
          history,
          "我最喜欢的编程语言是什么？只回答语言名称。",
          {
            systemPrompt: CONTEXT_SYSTEM_PROMPT,
          }
        );

        reporter.setInput("history: 1 轮 + '最喜欢什么？'");
        reporter.setOutput(`回复: "${result.text.slice(0, 100)}"`);

        expect(result.success).toBe(true);

        const hasTypeScript =
          result.text.includes("TypeScript") ||
          result.text.includes("typescript") ||
          result.text.includes("TS");

        expect(hasTypeScript).toBe(true);
      });
    } finally {
      reporter.done();
    }
  });
});
