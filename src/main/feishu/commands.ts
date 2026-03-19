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

function buildCard(options: {
  title: string;
  template: "blue" | "green" | "orange" | "indigo" | "red";
  content: string;
}): object {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: options.title },
      template: options.template,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: options.content,
        },
      ],
    },
  };
}

function buildSimpleCard(text: string): object {
  return buildCard({
    title: "✨ Zora",
    template: "indigo",
    content: text,
  });
}

async function replyWithCard(
  gateway: Pick<FeishuGateway, "replyMessage">,
  messageId: string,
  card: object
): Promise<void> {
  await gateway.replyMessage(messageId, "interactive", JSON.stringify(card));
}

const COMMANDS: Record<string, CommandHandler> = {
  "/help": async (ctx) => {
    await replyWithCard(
      ctx.gateway,
      ctx.messageId,
      buildCard({
        title: "📖 Zora 使用帮助",
        template: "blue",
        content: [
          "**可用命令：**",
          "",
          "`/new` — 创建新对话（重置当前会话上下文）",
          "`/stop` — 中断 Zora 正在执行的任务",
          "`/status` — 查看当前会话状态",
          "`/help` — 显示此帮助信息",
          "",
          "---",
          "",
          "直接发送文字消息即可与 Zora 对话 ✨",
        ].join("\n"),
      })
    );
  },

  "/new": async (ctx) => {
    const currentBinding = ctx.binder.getBindingByChatId(ctx.chatId);
    if (currentBinding && isAgentRunningForSession(currentBinding.sessionId)) {
      await stopAgentForSession(currentBinding.sessionId);
    }

    await ctx.binder.resetBinding(ctx.chatId, ctx.senderId);

    await replyWithCard(
      ctx.gateway,
      ctx.messageId,
      buildCard({
        title: "🔄 新对话已创建",
        template: "green",
        content: "已创建全新对话，之前的上下文已重置。\n直接发送消息开始新的对话吧！",
      })
    );
  },

  "/stop": async (ctx) => {
    const binding = ctx.binder.getBindingByChatId(ctx.chatId);
    if (!binding) {
      await replyWithCard(
        ctx.gateway,
        ctx.messageId,
        buildSimpleCard("当前没有活跃的对话。")
      );
      return;
    }

    if (!isAgentRunningForSession(binding.sessionId)) {
      await replyWithCard(
        ctx.gateway,
        ctx.messageId,
        buildSimpleCard("当前没有正在执行的任务。")
      );
      return;
    }

    await stopAgentForSession(binding.sessionId);

    await replyWithCard(
      ctx.gateway,
      ctx.messageId,
      buildCard({
        title: "⏹ 任务已中断",
        template: "orange",
        content: "已中断当前任务。你可以发送新消息继续对话。",
      })
    );
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
      buildCard({
        title: "📊 当前状态",
        template: "indigo",
        content,
      })
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
