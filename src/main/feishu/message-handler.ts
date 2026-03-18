import type { FeishuGateway } from "./gateway";

const DEDUPE_TTL_MS = 5 * 60 * 1000;

type FeishuMessageEvent = {
  event_id?: string;
  sender?: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
  };
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
    mentions?: Array<{
      key?: string;
      name?: string;
      id?: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
    }>;
  };
};

type FeishuGatewayLike = Pick<
  FeishuGateway,
  "getBotOpenId" | "getBotName" | "rememberBotIdentity"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function scheduleExpiry(target: Set<string>, key: string): void {
  const timeout = setTimeout(() => {
    target.delete(key);
  }, DEDUPE_TTL_MS);

  timeout.unref?.();
}

function addToDedupeSet(target: Set<string>, key: string): boolean {
  if (target.has(key)) {
    return false;
  }

  target.add(key);
  scheduleExpiry(target, key);
  return true;
}

function getContentPlaceholder(messageType: string): string {
  if (messageType === "text") {
    return "";
  }

  return `[${messageType}]`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanupTextContent(
  text: string,
  mentions: Array<{
    key?: string;
    name?: string;
    id?: { open_id?: string };
  }>,
  targetBotOpenId: string | null,
  targetBotName: string | null
): string {
  let nextText = text;

  for (const mention of mentions) {
    const matchesBot =
      (targetBotOpenId && mention.id?.open_id === targetBotOpenId) ||
      (targetBotName && mention.name === targetBotName);

    if (!matchesBot) {
      continue;
    }

    if (mention.key) {
      nextText = nextText.replace(new RegExp(escapeRegExp(mention.key), "g"), " ");
    }

    if (mention.name) {
      nextText = nextText.replace(new RegExp(`@${escapeRegExp(mention.name)}`, "g"), " ");
      nextText = nextText.replace(
        new RegExp(`<at[^>]*>${escapeRegExp(mention.name)}<\\/at>`, "g"),
        " "
      );
    }
  }

  return nextText.replace(/\s+/g, " ").trim();
}

function parseTextFromContent(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as unknown;

    if (isRecord(parsed) && typeof parsed.text === "string") {
      return parsed.text;
    }

    return null;
  } catch {
    return null;
  }
}

export class FeishuMessageHandler {
  private recentEventIds = new Set<string>();
  private recentMessageIds = new Set<string>();
  private processingChats = new Set<string>();
  private gateway: FeishuGatewayLike | null = null;
  private triggerAgent:
    | ((
        chatId: string,
        senderId: string,
        chatType: "p2p" | "group",
        text: string,
        userMessageId: string
      ) => Promise<void>)
    | null = null;

  setGateway(gateway: FeishuGatewayLike): void {
    this.gateway = gateway;
  }

  setTriggerAgent(
    triggerAgent: (
      chatId: string,
      senderId: string,
      chatType: "p2p" | "group",
      text: string,
      userMessageId: string
    ) => Promise<void>
  ): void {
    this.triggerAgent = triggerAgent;
  }

  async handleMessage(eventData: unknown): Promise<void> {
    const data = (isRecord(eventData) ? eventData : {}) as FeishuMessageEvent;
    const eventId = data.event_id?.trim();

    if (eventId && !addToDedupeSet(this.recentEventIds, eventId)) {
      return;
    }

    const messageId = data.message?.message_id?.trim();
    const chatId = data.message?.chat_id?.trim();
    const chatType = data.message?.chat_type?.trim() ?? "unknown";
    const normalizedChatType = chatType === "group" ? "group" : "p2p";
    const messageType = data.message?.message_type?.trim() ?? "unknown";
    const senderType = data.sender?.sender_type?.trim();
    const senderId =
      data.sender?.sender_id?.open_id?.trim() ||
      data.sender?.sender_id?.user_id?.trim() ||
      data.sender?.sender_id?.union_id?.trim() ||
      "";

    if (!messageId || !chatId) {
      return;
    }

    if (senderType !== "user") {
      return;
    }

    const gateway = this.gateway;
    const botOpenId = gateway?.getBotOpenId() ?? null;
    const botName = gateway?.getBotName() ?? null;

    if (botOpenId && senderId === botOpenId) {
      return;
    }

    if (!addToDedupeSet(this.recentMessageIds, messageId)) {
      return;
    }

    const mentions = data.message?.mentions ?? [];

    if (chatType === "group") {
      const matchedMention =
        mentions.find((mention) => botOpenId && mention.id?.open_id === botOpenId) ??
        mentions.find((mention) => botName && mention.name === botName) ??
        null;
      const allowUnknownBotIdentity = !botOpenId && !botName && mentions.length > 0;

      if (!matchedMention && !allowUnknownBotIdentity) {
        return;
      }

      if (matchedMention) {
        gateway?.rememberBotIdentity({
          openId: matchedMention.id?.open_id ?? null,
          name: matchedMention.name ?? null,
        });
      }
    }

    if (this.processingChats.has(chatId)) {
      return;
    }

    this.processingChats.add(chatId);

    let text = getContentPlaceholder(messageType);

    try {

      if (messageType === "text" && typeof data.message?.content === "string") {
        const parsedText = parseTextFromContent(data.message.content);

        text =
          parsedText !== null
            ? cleanupTextContent(parsedText, mentions, gateway?.getBotOpenId() ?? null, gateway?.getBotName() ?? null)
            : "[text]";
      }

      console.log("[Feishu] 收到消息:", {
        chatId,
        chatType: normalizedChatType,
        senderId,
        messageType,
        text,
        messageId,
      });
    } finally {
      this.processingChats.delete(chatId);
    }

    if (messageType !== "text" || text.trim().length === 0) {
      return;
    }

    if (text.startsWith("/")) {
      console.log("[Feishu] 命令（暂未实现）:", text);
      return;
    }

    if (!this.triggerAgent) {
      console.warn("[Feishu] triggerAgent is not configured, skipping message.");
      return;
    }

    await this.triggerAgent(chatId, senderId, normalizedChatType, text, messageId);
  }
}
