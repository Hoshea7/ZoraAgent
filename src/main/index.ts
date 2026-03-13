import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import type {
  AgentStreamEvent,
  AskUserResponse,
  PermissionMode,
  PermissionResponse,
} from "../shared/zora";
import {
  isAgentRunning,
  resolveSDKCliPath,
  runAgentWithProfile,
  stopClaudeAgentChat,
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

  ipcMain.handle("agent:chat", async (event, text: unknown) => {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("A non-empty prompt is required.");
    }
    if (isAgentRunning()) {
      throw new Error("An agent is already running.");
    }

    const target = event.sender;
    const forwardEvent = (payload: AgentStreamEvent) => {
      if (!target.isDestroyed()) {
        target.send("agent:stream", payload);
      }
    };

    const existingSessionId = getSessionId("productivity");
    const profile = await buildProductivityProfile({
      userPrompt: text.trim(),
      cwd: app.getAppPath(),
      sdkCliPath: resolveSDKCliPath(),
      onEvent: forwardEvent,
      isFirstTurn: !existingSessionId,
      sessionId: existingSessionId,
    });

    await runAgentWithProfile(profile, forwardEvent);
  });

  ipcMain.handle("agent:awaken", async (event, text: unknown) => {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("A non-empty prompt is required.");
    }
    if (isAgentRunning()) {
      throw new Error("An agent is already running.");
    }

    const target = event.sender;
    const forwardEvent = (payload: AgentStreamEvent) => {
      if (!target.isDestroyed()) {
        target.send("agent:stream", payload);
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

    await runAgentWithProfile(profile, forwardEvent);
  });

  ipcMain.handle("agent:awakening-complete", async () => {
    clearSessionId("awakening");
    console.log("[index] Awakening complete, session cleared.");
  });

  ipcMain.handle("agent:stop", async () => {
    await stopClaudeAgentChat();
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
