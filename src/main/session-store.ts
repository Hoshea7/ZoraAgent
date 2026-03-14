import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ChatMessage } from "../shared/zora";

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sdkSessionId?: string;
}

const SESSIONS_DIR = path.join(homedir(), ".zora", "sessions");
const INDEX_FILE = path.join(SESSIONS_DIR, "index.json");

async function ensureSessionsDir(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

async function replaceFileAtomically(
  filePath: string,
  content: string
): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, "utf8");

  try {
    await rename(tmpPath, filePath);
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code: string }).code
        : "";

    if (code === "EEXIST" || code === "EPERM") {
      try {
        await unlink(filePath);
      } catch {
        // Ignore missing destination files.
      }

      await rename(tmpPath, filePath);
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

async function readIndex(): Promise<SessionMeta[]> {
  try {
    const raw = await readFile(INDEX_FILE, "utf8");
    return JSON.parse(raw) as SessionMeta[];
  } catch {
    return [];
  }
}

async function writeIndex(sessions: SessionMeta[]): Promise<void> {
  await ensureSessionsDir();
  await replaceFileAtomically(INDEX_FILE, JSON.stringify(sessions, null, 2));
}

export async function listSessions(): Promise<SessionMeta[]> {
  return readIndex();
}

export async function createSession(title: string): Promise<SessionMeta> {
  const now = new Date().toISOString();
  const meta: SessionMeta = {
    id: randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
  };

  const sessions = await readIndex();
  sessions.unshift(meta);
  await writeIndex(sessions);
  return meta;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const sessions = await readIndex();
  await writeIndex(sessions.filter((session) => session.id !== sessionId));

  try {
    await unlink(path.join(SESSIONS_DIR, `${sessionId}.jsonl`));
  } catch {
    // Step 1 does not create message files yet.
  }
}

export async function updateSessionMeta(
  sessionId: string,
  updates: Partial<Pick<SessionMeta, "title" | "sdkSessionId">>
): Promise<void> {
  const sessions = await readIndex();
  const index = sessions.findIndex((session) => session.id === sessionId);

  if (index === -1) {
    return;
  }

  sessions[index] = {
    ...sessions[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await writeIndex(sessions);
}

export async function setSdkSessionId(
  sessionId: string,
  sdkSessionId: string
): Promise<void> {
  await updateSessionMeta(sessionId, { sdkSessionId });
}

export async function clearSdkSessionId(sessionId: string): Promise<void> {
  await updateSessionMeta(sessionId, { sdkSessionId: undefined });
}

export async function getSdkSessionId(
  sessionId: string
): Promise<string | undefined> {
  const sessions = await readIndex();
  return sessions.find((session) => session.id === sessionId)?.sdkSessionId;
}

type MessageRecord =
  | { kind: "user"; message: ChatMessage }
  | { kind: "assistant_block"; message: ChatMessage }
  | { kind: "tool_result"; toolUseId: string; result: string; isError: boolean };

function getJsonlPath(sessionId: string): string {
  return path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function appendMessageRecord(
  sessionId: string,
  record: MessageRecord
): Promise<void> {
  await ensureSessionsDir();
  await appendFile(getJsonlPath(sessionId), `${JSON.stringify(record)}\n`, "utf8");
}

export async function loadMessages(sessionId: string): Promise<ChatMessage[]> {
  let content: string;

  try {
    content = await readFile(getJsonlPath(sessionId), "utf8");
  } catch {
    return [];
  }

  const messages: ChatMessage[] = [];

  for (const line of content.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const record = JSON.parse(line) as MessageRecord;

      if (record.kind === "user" || record.kind === "assistant_block") {
        messages.push(record.message);
        continue;
      }

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].toolUseId === record.toolUseId) {
          messages[index] = {
            ...messages[index],
            toolResult: record.result,
            toolStatus: record.isError ? "error" : "done",
          };
          break;
        }
      }
    } catch {
      // Ignore malformed lines so one bad record does not block loading.
    }
  }

  return messages;
}

export function persistAssistantMessage(sessionId: string, sdkMessage: unknown): void {
  if (typeof sdkMessage !== "object" || sdkMessage === null) {
    return;
  }

  const content = (sdkMessage as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return;
  }

  for (const block of content) {
    if (typeof block !== "object" || block === null) {
      continue;
    }

    const item = block as Record<string, unknown>;

    if (item.type === "text" && typeof item.text === "string") {
      void appendMessageRecord(sessionId, {
        kind: "assistant_block",
        message: {
          id: makeId("text"),
          role: "assistant",
          type: "text",
          text: item.text,
          thinking: "",
          status: "done",
        },
      });
      continue;
    }

    if (item.type === "thinking" && typeof item.thinking === "string") {
      void appendMessageRecord(sessionId, {
        kind: "assistant_block",
        message: {
          id: makeId("thinking"),
          role: "assistant",
          type: "thinking",
          text: "",
          thinking: item.thinking,
          status: "done",
        },
      });
      continue;
    }

    if (item.type === "tool_use") {
      void appendMessageRecord(sessionId, {
        kind: "assistant_block",
        message: {
          id: makeId("tooluse"),
          role: "assistant",
          type: "tool_use",
          text: "",
          thinking: "",
          toolName: typeof item.name === "string" ? item.name : "unknown",
          toolUseId: typeof item.id === "string" ? item.id : "",
          toolInput:
            typeof item.input === "string"
              ? item.input
              : JSON.stringify(item.input ?? ""),
          toolResult: "",
          toolStatus: "running",
          status: "done",
        },
      });
    }
  }
}

export function persistToolResults(sessionId: string, sdkMessage: unknown): void {
  if (typeof sdkMessage !== "object" || sdkMessage === null) {
    return;
  }

  const content = (sdkMessage as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return;
  }

  for (const block of content) {
    if (typeof block !== "object" || block === null) {
      continue;
    }

    const item = block as Record<string, unknown>;
    if (item.type !== "tool_result" || typeof item.tool_use_id !== "string") {
      continue;
    }

    void appendMessageRecord(sessionId, {
      kind: "tool_result",
      toolUseId: item.tool_use_id,
      result:
        typeof item.content === "string"
          ? item.content
          : JSON.stringify(item.content ?? ""),
      isError: item.is_error === true,
    });
  }
}
