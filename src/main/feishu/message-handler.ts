import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FeishuGateway } from "./gateway";
import { isRecord } from "../utils/guards";
import { ZORA_DIR, ensureZoraDir, isEnoentError, replaceFileAtomically } from "../utils/fs";
import { handleCommand } from "./commands";
import type { FeishuSessionBinder } from "./session-binder";

const DEDUPE_TTL_MS = 5 * 60 * 1000;
const PERSISTED_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 5_000;
const FEISHU_DEDUP_FILE = path.join(ZORA_DIR, "feishu-dedup.json");

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
  "getBotOpenId" | "getBotName" | "rememberBotIdentity" | "replyMessage"
>;

type FeishuDedupStore = {
  processedMessages?: Record<string, unknown>;
  lastCleanup?: number;
};

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

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export class FeishuMessageHandler {
  private recentEventIds = new Set<string>();
  private recentMessageIds = new Set<string>();
  private processingChats = new Set<string>();
  private processedMessages = new Map<string, number>();
  private dedupFilePath = FEISHU_DEDUP_FILE;
  private dirty = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private gateway: FeishuGatewayLike | null = null;
  private binder: Pick<FeishuSessionBinder, "getBindingByChatId" | "resetBinding"> | null = null;
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

  setBinder(binder: Pick<FeishuSessionBinder, "getBindingByChatId" | "resetBinding">): void {
    this.binder = binder;
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

  async init(): Promise<void> {
    this.recentEventIds.clear();
    this.recentMessageIds.clear();
    this.processingChats.clear();
    this.processedMessages.clear();

    let shouldRewrite = false;

    try {
      const raw = await readFile(this.dedupFilePath, "utf8");
      const parsed = JSON.parse(raw) as FeishuDedupStore;
      const now = Date.now();

      if (!isRecord(parsed?.processedMessages)) {
        shouldRewrite = true;
      } else {
        for (const [messageId, timestamp] of Object.entries(parsed.processedMessages)) {
          if (
            typeof messageId !== "string" ||
            messageId.trim().length === 0 ||
            !isValidTimestamp(timestamp)
          ) {
            shouldRewrite = true;
            continue;
          }

          if (now - timestamp > PERSISTED_DEDUPE_TTL_MS) {
            shouldRewrite = true;
            continue;
          }

          this.processedMessages.set(messageId, timestamp);
          this.recentMessageIds.add(messageId);
        }
      }
    } catch (error: unknown) {
      if (!isEnoentError(error)) {
        console.warn("[Feishu] Failed to load dedup store, starting from empty state.", error);
      }
      return;
    }

    if (shouldRewrite) {
      this.dirty = true;
      await this.persistDedup().catch((error) => {
        console.warn("[Feishu] Failed to rewrite dedup store during init.", error);
      });
    }
  }

  async shutdown(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    await this.persistDedup().catch((error) => {
      console.warn("[Feishu] Failed to flush dedup store during shutdown.", error);
    });
  }

  private cleanupProcessedMessages(now = Date.now()): boolean {
    let removed = false;

    for (const [messageId, timestamp] of this.processedMessages.entries()) {
      if (now - timestamp > PERSISTED_DEDUPE_TTL_MS) {
        this.processedMessages.delete(messageId);
        removed = true;
      }
    }

    return removed;
  }

  private markMessageProcessed(messageId: string, timestamp = Date.now()): void {
    addToDedupeSet(this.recentMessageIds, messageId);
    this.processedMessages.set(messageId, timestamp);
    this.dirty = true;
    this.schedulePersist();
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      return;
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistDedup().catch((error) => {
        console.warn("[Feishu] Failed to persist dedup store.", error);
      });
    }, PERSIST_DEBOUNCE_MS);

    this.persistTimer.unref?.();
  }

  private async persistDedup(): Promise<void> {
    const cleaned = this.cleanupProcessedMessages();
    if (!this.dirty && !cleaned) {
      return;
    }

    await ensureZoraDir();

    const processedMessages = Object.fromEntries(
      [...this.processedMessages.entries()].sort((left, right) => left[1] - right[1])
    );

    await replaceFileAtomically(
      this.dedupFilePath,
      `${JSON.stringify(
        {
          processedMessages,
          lastCleanup: Date.now(),
        },
        null,
        2
      )}\n`
    );

    this.dirty = false;
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

    if (this.recentMessageIds.has(messageId) || this.processedMessages.has(messageId)) {
      console.log("[Feishu] 消息去重（跳过）:", messageId);
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
    this.markMessageProcessed(messageId);

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
      if (!this.gateway || !this.binder) {
        console.warn("[Feishu] Command dependencies are not configured, treating as plain text.");
      } else {
        const handled = await handleCommand(text, {
          chatId,
          senderId,
          messageId,
          gateway: this.gateway,
          binder: this.binder,
        });

        if (handled) {
          return;
        }
      }
    }

    if (!this.triggerAgent) {
      console.warn("[Feishu] triggerAgent is not configured, skipping message.");
      return;
    }

    await this.triggerAgent(chatId, senderId, normalizedChatType, text, messageId);
  }
}
