import { isAgentRunningForSession, stopAgentForSession } from "../agent";
import type { FeishuGateway } from "./gateway";
import type { FeishuSessionBinder } from "./session-binder";

type CommandContext = {
  chatId: string;
  senderId: string;
  messageId: string;
  args: string;
  gateway: Pick<FeishuGateway, "replyMessage">;
  binder: Pick<FeishuSessionBinder, "getBindingByChatId" | "resetBinding">;
};

type CommandHandler = (ctx: CommandContext) => Promise<void>;

function buildCard(content: string): object {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    body: {
      elements: [
        {
          tag: "markdown",
          content,
        },
      ],
    },
  };
}

function buildTextContent(text: string): string {
  return JSON.stringify({ text });
}

async function replyWithCard(
  gateway: Pick<FeishuGateway, "replyMessage">,
  messageId: string,
  card: object
): Promise<void> {
  await gateway.replyMessage(messageId, "interactive", JSON.stringify(card));
}

async function replyWithText(
  gateway: Pick<FeishuGateway, "replyMessage">,
  messageId: string,
  text: string
): Promise<void> {
  await gateway.replyMessage(messageId, "text", buildTextContent(text));
}

const COMMANDS: Record<string, CommandHandler> = {
  "/help": async (ctx) => {
    await replyWithCard(
      ctx.gateway,
      ctx.messageId,
      buildCard(
        [
          "**📖 Zora 使用帮助**",
          "",
          "`/new` — 创建新对话",
          "`/stop` — 中断当前任务",
          "`/status` — 查看状态",
          "`/help` — 显示帮助",
          "",
          "直接发送消息即可对话 ✨",
        ].join("\n")
      )
    );
  },

  "/new": async (ctx) => {
    const currentBinding = ctx.binder.getBindingByChatId(ctx.chatId);
    if (currentBinding && isAgentRunningForSession(currentBinding.sessionId)) {
      await stopAgentForSession(currentBinding.sessionId);
    }

    await ctx.binder.resetBinding(ctx.chatId, ctx.senderId);

    await replyWithText(ctx.gateway, ctx.messageId, "🔄 新对话已创建，之前的上下文已重置。");
  },

  "/stop": async (ctx) => {
    const binding = ctx.binder.getBindingByChatId(ctx.chatId);
    if (!binding) {
      await replyWithText(ctx.gateway, ctx.messageId, "当前没有活跃的对话。");
      return;
    }

    if (!isAgentRunningForSession(binding.sessionId)) {
      await replyWithText(ctx.gateway, ctx.messageId, "当前没有正在执行的任务。");
      return;
    }

    await stopAgentForSession(binding.sessionId);

    await replyWithText(ctx.gateway, ctx.messageId, "⏹ 已中断当前任务。");
  },

  "/status": async (ctx) => {
    const binding = ctx.binder.getBindingByChatId(ctx.chatId);
    const content = binding
      ? [
          `**会话 ID:** \`${binding.sessionId.slice(0, 8)}...\``,
          `**工作区:** ${binding.workspaceId}`,
          `**Agent 状态:** ${isAgentRunningForSession(binding.sessionId) ? "🟢 运行中" : "⚪ 空闲"}`,
          `**创建时间:** ${new Date(binding.createdAt).toLocaleString("zh-CN")}`,
        ].join("\n")
      : "当前没有活跃的会话。发送任意消息即可创建。";

    await replyWithCard(
      ctx.gateway,
      ctx.messageId,
      buildCard(
        [
          "**📊 当前状态**",
          "",
          content,
        ].join("\n")
      )
    );
  },
};

export async function handleCommand(
  commandText: string,
  ctx: Omit<CommandContext, "args">
): Promise<boolean> {
  const trimmed = commandText.trim();
  if (!trimmed.startsWith("/")) {
    return false;
  }

  const spaceIndex = trimmed.indexOf(" ");
  const command =
    (spaceIndex >= 0 ? trimmed.slice(0, spaceIndex) : trimmed).toLowerCase();
  const args = spaceIndex >= 0 ? trimmed.slice(spaceIndex + 1).trim() : "";
  const handler = COMMANDS[command];

  if (!handler) {
    return false;
  }

  await handler({
    ...ctx,
    args,
  });
  return true;
}
