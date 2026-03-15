import { app, BrowserWindow, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AgentStreamEvent,
  AskUserResponse,
  ChatMessage,
  PermissionMode,
  PermissionResponse,
} from "../shared/zora";
import {
  isAgentRunningForSession,
  MissingSdkSessionError,
  resolveSDKCliPath,
  runAgentWithProfile,
  stopAgentForSession,
} from "./agent";
import {
  respondToAskUser,
  respondToPermission,
  setPermissionMode,
} from "./hitl";
import { ensureBootstrapScaffold } from "./memory-store";
import { isBootstrapMode } from "./prompt-builder";
import {
  buildAwakeningProfile,
  buildProductivityProfile,
} from "./query-profiles";
import {
  appendMessageRecord,
  clearSdkSessionId,
  createSession,
  deleteSession,
  getSdkSessionId,
  listSessions,
  loadMessages,
  migrateSessionsIfNeeded,
  persistAssistantMessage,
  persistToolResults,
  renameSession,
  updateSessionMeta,
} from "./session-store";
import { clearSessionId, getSessionId } from "./session-manager";
import { GLOBAL_SKILLS_DIR, listSkills, seedBundledSkills } from "./skill-manager";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "ask" || value === "smart" || value === "yolo";
}

const RECOVERY_MAX_MESSAGES = 80;
const RECOVERY_MAX_TRANSCRIPT_CHARS = 100_000;
const RECOVERY_MAX_TOOL_IO_CHARS = 4_000;

function truncateForRecovery(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...[truncated]`;
}

function serializeMessageForRecovery(message: ChatMessage): string[] {
  if (message.role === "user") {
    const text = message.text.trim();
    return text ? [`User: ${text}`] : [];
  }

  if (message.type === "text") {
    const text = message.text.trim();
    return text ? [`Assistant: ${text}`] : [];
  }

  if (message.type === "tool_use") {
    const toolName = message.toolName || "unknown";
    const sections = [
      `Assistant used tool ${toolName} with input:\n${truncateForRecovery(
        message.toolInput || "(empty input)",
        RECOVERY_MAX_TOOL_IO_CHARS
      )}`
    ];

    if (message.toolResult) {
      sections.push(
        `Tool result from ${toolName}:\n${truncateForRecovery(
          message.toolResult,
          RECOVERY_MAX_TOOL_IO_CHARS
        )}`
      );
    }

    return sections;
  }

  return [];
}

function buildRecoveredPromptFromMessages(messages: ChatMessage[], fallbackUserPrompt: string): string {
  const transcriptSections: string[] = [];
  let transcriptLength = 0;

  for (const message of messages.slice(-RECOVERY_MAX_MESSAGES)) {
    for (const section of serializeMessageForRecovery(message)) {
      if (transcriptLength + section.length > RECOVERY_MAX_TRANSCRIPT_CHARS) {
        transcriptSections.push("[Earlier transcript truncated for length.]");
        transcriptLength = RECOVERY_MAX_TRANSCRIPT_CHARS;
        break;
      }

      transcriptSections.push(section);
      transcriptLength += section.length + 2;
    }

    if (transcriptLength >= RECOVERY_MAX_TRANSCRIPT_CHARS) {
      break;
    }
  }

  const transcript =
    transcriptSections.length > 0
      ? transcriptSections.join("\n\n")
      : `User: ${fallbackUserPrompt}`;

  return [
    "The previous Claude Code session for this local Zora conversation is unavailable.",
    "Resume the conversation from the locally persisted transcript below.",
    "Treat the transcript as authoritative history for this conversation.",
    "Continue naturally from the final user message without mentioning recovery unless the user asks.",
    "Conversation transcript:",
    transcript
  ].join("\n\n");
}

async function startProductivityRun(
  sessionId: string,
  text: string,
  forwardEvent: (payload: AgentStreamEvent) => void
) {
  const sdkCliPath = resolveSDKCliPath();
  const currentPrompt = text.trim();
  const existingSDKSessionId = await getSdkSessionId(sessionId);
  const profile = await buildProductivityProfile({
    userPrompt: currentPrompt,
    cwd: app.getAppPath(),
    sdkCliPath,
    onEvent: forwardEvent,
    isFirstTurn: !existingSDKSessionId,
    sessionId: existingSDKSessionId,
  });

  try {
    await runAgentWithProfile(sessionId, profile, forwardEvent);
  } catch (error) {
    if (!(error instanceof MissingSdkSessionError) || !existingSDKSessionId) {
      throw error;
    }

    console.warn(
      `[index] Stored SDK session ${existingSDKSessionId} is unavailable for local session ${sessionId}. Rebuilding context from local transcript.`
    );

    await clearSdkSessionId(sessionId);
    const persistedMessages = await loadMessages(sessionId);
    const rebuiltPrompt = buildRecoveredPromptFromMessages(persistedMessages, currentPrompt);
    const recoveredProfile = await buildProductivityProfile({
      userPrompt: rebuiltPrompt,
      cwd: app.getAppPath(),
      sdkCliPath,
      onEvent: forwardEvent,
      isFirstTurn: false,
      sessionId: undefined,
    });

    await runAgentWithProfile(sessionId, recoveredProfile, forwardEvent);
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#09111f",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(app.getAppPath(), "dist", "main", "preload.js")
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
    return;
  }

  window.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"));
}

app.whenReady().then(async () => {
  await migrateSessionsIfNeeded();
  await seedBundledSkills();

  ipcMain.handle("app:get-version", () => app.getVersion());

  ipcMain.handle("skill:list", () => {
    return listSkills();
  });

  ipcMain.handle("skill:open-dir", async () => {
    const error = await shell.openPath(GLOBAL_SKILLS_DIR);
    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle("skill:open-skill-dir", async (_event, dirName: unknown) => {
    if (
      typeof dirName !== "string" ||
      dirName.trim().length === 0 ||
      path.basename(dirName) !== dirName
    ) {
      throw new Error("A valid skill directory name is required.");
    }

    const error = await shell.openPath(path.join(GLOBAL_SKILLS_DIR, dirName));
    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle("session:list", async () => {
    return listSessions();
  });

  ipcMain.handle("session:create", async (_event, title: string) => {
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new Error("Session title is required.");
    }

    return createSession(title.trim());
  });

  ipcMain.handle("session:delete", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new Error("A valid sessionId is required.");
    }

    await deleteSession(sessionId);
    console.log(`[index] Session deleted: ${sessionId}`);
  });

  ipcMain.handle("session:rename", async (_event, sessionId: unknown, title: unknown) => {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new Error("A valid sessionId is required.");
    }
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new Error("A non-empty title is required.");
    }

    const nextTitle = title.trim();
    await renameSession(sessionId, nextTitle);
    console.log(`[index] Session renamed: ${sessionId} -> "${nextTitle}"`);
  });

  ipcMain.handle("session:load-messages", async (_event, sessionId: string) => {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("Session ID is required.");
    }

    return loadMessages(sessionId);
  });

  ipcMain.handle("agent:chat", async (event, text: unknown, sessionId: unknown) => {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("A non-empty prompt is required.");
    }
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new Error("A valid sessionId is required.");
    }

    if (isAgentRunningForSession(sessionId)) {
      throw new Error(`An agent is already running for session ${sessionId}.`);
    }

    console.log(`[index] Current mode: productivity, session: ${sessionId}`);

    await updateSessionMeta(sessionId, {});
    await appendMessageRecord(sessionId, {
      kind: "user",
      message: {
        id: `user-${randomUUID()}`,
        role: "user",
        type: "text",
        text: text.trim(),
        thinking: "",
        status: "done",
      },
    });

    const target = event.sender;
    const forwardEvent = (payload: AgentStreamEvent) => {
      if (!target.isDestroyed()) {
        target.send("agent:stream", { ...payload, sessionId });
      }

      const message = payload as Record<string, unknown>;

      if (message.type === "assistant" && "message" in message) {
        persistAssistantMessage(sessionId, message.message);
      }

      if (message.type === "user" && "message" in message) {
        persistToolResults(sessionId, message.message);
      }
    };

    void startProductivityRun(sessionId, text.trim(), forwardEvent).catch((err) => {
      console.error(`[index] Agent run failed for session ${sessionId}:`, err);
    });
  });

  ipcMain.handle("agent:awaken", async (event, text: unknown) => {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("A non-empty prompt is required.");
    }
    if (isAgentRunningForSession("__awakening__")) {
      throw new Error("Awakening agent is already running.");
    }

    console.log("[index] Current mode: awakening");

    const target = event.sender;
    const forwardEvent = (payload: AgentStreamEvent) => {
      if (!target.isDestroyed()) {
        target.send("agent:stream", { ...payload, sessionId: "__awakening__" });
      }
    };

    const existingSessionId = getSessionId("awakening");
    const profile = await buildAwakeningProfile({
      userPrompt: text.trim(),
      cwd: app.getAppPath(),
      sdkCliPath: resolveSDKCliPath(),
      onEvent: forwardEvent,
      isFirstTurn: !existingSessionId,
      sessionId: existingSessionId,
    });

    await runAgentWithProfile("__awakening__", profile, forwardEvent);
  });

  ipcMain.handle("agent:awakening-complete", async () => {
    const createdFiles = await ensureBootstrapScaffold();
    await stopAgentForSession("__awakening__");
    clearSessionId("awakening");
    if (createdFiles.length > 0) {
      console.log(
        `[index] Awakening skipped before bootstrap completed. Created default scaffold: ${createdFiles.join(", ")}.`
      );
    }
    console.log("[index] Awakening complete, session cleared.");
  });

  ipcMain.handle("agent:stop", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new Error("A valid sessionId is required.");
    }
    await stopAgentForSession(sessionId);
  });

  ipcMain.handle("zora:is-awakened", async () => {
    const bootstrapMode = await isBootstrapMode();
    return !bootstrapMode;
  });

  ipcMain.handle(
    "agent:permission-mode:set",
    async (_event, mode: unknown) => {
      if (!isPermissionMode(mode)) {
        throw new Error("Invalid permission mode.");
      }

      setPermissionMode(mode);
    }
  );

  ipcMain.handle(
    "agent:permission:respond",
    async (_event, response: PermissionResponse) => {
      respondToPermission(
        response.requestId,
        response.behavior,
        response.alwaysAllow,
        response.userMessage
      );
    }
  );

  ipcMain.handle(
    "agent:ask-user:respond",
    async (_event, response: AskUserResponse) => {
      respondToAskUser(response.requestId, response.answers);
    }
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
