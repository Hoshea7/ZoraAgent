import { mkdir, readFile, rename as fsRename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  FeishuChatBinding,
  FeishuChatType,
} from "../../shared/types/feishu";
import { createSession } from "../session-store";
import { getWorkspacePath } from "../workspace-store";
import { loadFeishuConfig } from "./config";

const ZORA_DIR = path.join(homedir(), ".zora");
const FEISHU_BINDINGS_FILE = path.join(ZORA_DIR, "feishu-bindings.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeChatType(value: unknown): FeishuChatType | null {
  return value === "group" || value === "p2p" ? value : null;
}

function isFeishuChatBinding(value: unknown): value is FeishuChatBinding {
  if (!isRecord(value)) {
    return false;
  }

  return (
    normalizeRequiredString(value.chatId) !== null &&
    normalizeRequiredString(value.userId) !== null &&
    normalizeRequiredString(value.sessionId) !== null &&
    normalizeRequiredString(value.workspaceId) !== null &&
    normalizeChatType(value.chatType) !== null &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt)
  );
}

async function replaceFileAtomically(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, "utf8");

  try {
    await fsRename(tmpPath, filePath);
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code: string }).code
        : "";

    if (code === "EEXIST" || code === "EPERM") {
      try {
        await unlink(filePath);
      } catch {
        // Ignore missing destination file.
      }

      await fsRename(tmpPath, filePath);
      return;
    }

    try {
      await unlink(tmpPath);
    } catch {
      // Ignore temp cleanup failures.
    }

    throw error;
  }
}

async function resolveWorkspaceId(): Promise<string> {
  const config = await loadFeishuConfig();
  const configuredWorkspaceId = normalizeRequiredString(config?.defaultWorkspaceId);

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
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        return;
      }

      console.warn("[feishu:binder] Failed to load bindings, starting from empty state.", error);
    }
  }

  private async persist(): Promise<void> {
    await mkdir(ZORA_DIR, { recursive: true });

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

    const normalizedChatType = chatType === "group" ? "group" : "p2p";
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

  isFeishuSession(sessionId: string): boolean {
    return this.sessionToChat.has(sessionId);
  }

  getAllBindings(): FeishuChatBinding[] {
    return [...this.chatToBinding.values()].sort(
      (left, right) => right.createdAt - left.createdAt
    );
  }
}
