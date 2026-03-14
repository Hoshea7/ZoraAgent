import { app, BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AgentStreamEvent,
  AskUserResponse,
  PermissionMode,
  PermissionResponse,
} from "../shared/zora";
import {
  isAgentRunningForSession,
  resolveSDKCliPath,
  runAgentWithProfile,
  stopAgentForSession,
} from "./agent";
import {
  respondToAskUser,
  respondToPermission,
  setPermissionMode,
} from "./hitl";
import { isBootstrapMode } from "./prompt-builder";
import {
  buildAwakeningProfile,
  buildProductivityProfile,
} from "./query-profiles";
import {
  appendMessageRecord,
  createSession,
  deleteSession,
  getSdkSessionId,
  listSessions,
  loadMessages,
  persistAssistantMessage,
  persistToolResults,
} from "./session-store";
import { clearSessionId, getSessionId } from "./session-manager";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "ask" || value === "smart" || value === "yolo";
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

app.whenReady().then(() => {
  ipcMain.handle("app:get-version", () => app.getVersion());

  ipcMain.handle("session:list", async () => {
    return listSessions();
  });

  ipcMain.handle("session:create", async (_event, title: string) => {
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new Error("Session title is required.");
    }

    return createSession(title.trim());
  });

  ipcMain.handle("session:delete", async (_event, sessionId: string) => {
    if (typeof sessionId !== "string") {
      throw new Error("Session ID is required.");
    }

    await deleteSession(sessionId);
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

    const existingSDKSessionId = await getSdkSessionId(sessionId);
    const profile = await buildProductivityProfile({
      userPrompt: text.trim(),
      cwd: app.getAppPath(),
      sdkCliPath: resolveSDKCliPath(),
      onEvent: forwardEvent,
      isFirstTurn: !existingSDKSessionId,
      sessionId: existingSDKSessionId,
    });

    runAgentWithProfile(sessionId, profile, forwardEvent).catch((err) => {
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
    clearSessionId("awakening");
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
