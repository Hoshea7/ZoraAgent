import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  FeishuChatBinding,
  FeishuChatType,
} from "../../shared/types/feishu";
import { isRecord } from "../utils/guards";
import { ZORA_DIR, ensureZoraDir, replaceFileAtomically, isEnoentError } from "../utils/fs";
import { normalizeOptionalString } from "../utils/validate";
import { createSession } from "../session-store";
import { getWorkspacePath } from "../workspace-store";
import { loadFeishuConfig } from "./config";

const FEISHU_BINDINGS_FILE = path.join(ZORA_DIR, "feishu-bindings.json");

function normalizeChatType(value: unknown): FeishuChatType | null {
  return value === "group" || value === "p2p" ? value : null;
}

function isFeishuChatBinding(value: unknown): value is FeishuChatBinding {
  if (!isRecord(value)) {
    return false;
  }

  return (
    normalizeOptionalString(value.chatId) !== null &&
    normalizeOptionalString(value.userId) !== null &&
    normalizeOptionalString(value.sessionId) !== null &&
    normalizeOptionalString(value.workspaceId) !== null &&
    normalizeChatType(value.chatType) !== null &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt)
  );
}

async function resolveWorkspaceId(): Promise<string> {
  const config = await loadFeishuConfig();
  const configuredWorkspaceId = normalizeOptionalString(config?.defaultWorkspaceId);

  if (!configuredWorkspaceId) {
    return "default";
  }

  try {
    await getWorkspacePath(configuredWorkspaceId);
    return configuredWorkspaceId;
  } catch {
    console.warn(
      `[feishu:binder] Workspace ${configuredWorkspaceId} does not exist, falling back to default.`
    );
    return "default";
  }
}

function buildSessionTitle(chatType: FeishuChatType, userId: string): string {
  const suffix = userId.slice(-6);
  return chatType === "group"
    ? `飞书群聊 ${suffix}`
    : `飞书私聊 ${suffix}`;
}

export class FeishuSessionBinder {
  private chatToBinding = new Map<string, FeishuChatBinding>();
  private sessionToChat = new Map<string, string>();

  async loadBindings(): Promise<void> {
    this.chatToBinding.clear();
    this.sessionToChat.clear();

    try {
      const raw = await readFile(FEISHU_BINDINGS_FILE, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed)) {
        return;
      }

      for (const item of parsed) {
        if (!isFeishuChatBinding(item)) {
          continue;
        }

        this.chatToBinding.set(item.chatId, item);
        this.sessionToChat.set(item.sessionId, item.chatId);
      }
    } catch (error: unknown) {
      if (isEnoentError(error)) {
        return;
      }

      console.warn("[feishu:binder] Failed to load bindings, starting from empty state.", error);
    }
  }

  private async persist(): Promise<void> {
    await ensureZoraDir();

    const bindings = [...this.chatToBinding.values()].sort(
      (left, right) => left.createdAt - right.createdAt
    );

    await replaceFileAtomically(
      FEISHU_BINDINGS_FILE,
      `${JSON.stringify(bindings, null, 2)}\n`
    );
  }

  async resolveBinding(
    chatId: string,
    userId: string,
    chatType: string
  ): Promise<FeishuChatBinding> {
    const existing = this.chatToBinding.get(chatId);
    if (existing) {
      return existing;
    }

    const normalizedChatType: FeishuChatType = chatType === "group" ? "group" : "p2p";
    const workspaceId = await resolveWorkspaceId();
    const session = await createSession(
      buildSessionTitle(normalizedChatType, userId),
      workspaceId
    );

    const binding: FeishuChatBinding = {
      chatId,
      userId,
      sessionId: session.id,
      workspaceId,
      chatType: normalizedChatType,
      createdAt: Date.now(),
    };

    this.chatToBinding.set(chatId, binding);
    this.sessionToChat.set(session.id, chatId);
    await this.persist();

    return binding;
  }

  async resetBinding(chatId: string, userId: string): Promise<FeishuChatBinding> {
    const previous = this.chatToBinding.get(chatId);
    if (previous) {
      this.sessionToChat.delete(previous.sessionId);
      this.chatToBinding.delete(chatId);
    }

    const workspaceId = previous?.workspaceId ?? (await resolveWorkspaceId());
    const chatType = previous?.chatType ?? "p2p";
    const session = await createSession(
      buildSessionTitle(chatType, userId),
      workspaceId
    );

    const binding: FeishuChatBinding = {
      chatId,
      userId,
      sessionId: session.id,
      workspaceId,
      chatType,
      createdAt: Date.now(),
    };

    this.chatToBinding.set(chatId, binding);
    this.sessionToChat.set(session.id, chatId);
    await this.persist();

    return binding;
  }

  getChatIdBySession(sessionId: string): string | null {
    return this.sessionToChat.get(sessionId) ?? null;
  }

  getBindingByChatId(chatId: string): FeishuChatBinding | null {
    return this.chatToBinding.get(chatId) ?? null;
  }

  isFeishuSession(sessionId: string): boolean {
    return this.sessionToChat.has(sessionId);
  }

  getAllBindings(): FeishuChatBinding[] {
    return [...this.chatToBinding.values()].sort(
      (left, right) => right.createdAt - left.createdAt
    );
  }
}
