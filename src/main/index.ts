import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type {
  AgentStreamEvent,
  AskUserResponse,
  ChatMessage,
  FileAttachment,
  PermissionMode,
  PermissionResponse,
} from "../shared/zora";
import type { ProviderCreateInput, ProviderUpdateInput } from "../shared/types/provider";
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
import { memoryAgent } from "./memory-agent";
import { ensureBootstrapScaffold } from "./memory-store";
import { isBootstrapMode } from "./prompt-builder";
import {
  buildAwakeningProfile,
  buildProductivityProfile,
} from "./query-profiles";
import { providerManager } from "./provider-manager";
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
  saveAttachments,
  updateSessionMeta,
} from "./session-store";
import { clearSessionId, getSessionId } from "./session-manager";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspacePath,
  listWorkspaces,
} from "./workspace-store";
import { GLOBAL_SKILLS_DIR, listSkills, seedBundledSkills } from "./skill-manager";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "ask" || value === "smart" || value === "yolo";
}

function resolveWorkspaceId(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "default";
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("A valid workspaceId is required.");
  }

  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function assertOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string when provided.`);
  }

  return value;
}

function assertOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean when provided.`);
  }

  return value;
}

function parseProviderCreateInput(input: unknown): ProviderCreateInput {
  if (!isRecord(input)) {
    throw new Error("A valid provider payload is required.");
  }

  return {
    name: assertRequiredString(input.name, "provider.name"),
    providerType: assertRequiredString(input.providerType, "provider.providerType") as ProviderCreateInput["providerType"],
    baseUrl: assertRequiredString(input.baseUrl, "provider.baseUrl"),
    apiKey: assertRequiredString(input.apiKey, "provider.apiKey"),
    modelId: assertOptionalString(input.modelId, "provider.modelId"),
  };
}

function parseProviderUpdateInput(input: unknown): ProviderUpdateInput {
  if (!isRecord(input)) {
    throw new Error("A valid provider payload is required.");
  }

  return {
    name: assertOptionalString(input.name, "provider.name"),
    providerType: assertOptionalString(
      input.providerType,
      "provider.providerType"
    ) as ProviderUpdateInput["providerType"],
    baseUrl: assertOptionalString(input.baseUrl, "provider.baseUrl"),
    apiKey: assertOptionalString(input.apiKey, "provider.apiKey"),
    modelId: assertOptionalString(input.modelId, "provider.modelId"),
    enabled: assertOptionalBoolean(input.enabled, "provider.enabled"),
  };
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"] as const;
const DOCUMENT_EXTENSIONS = ["pdf"] as const;
const TEXT_EXTENSIONS = [
  "txt",
  "md",
  "csv",
  "json",
  "xml",
  "py",
  "js",
  "ts",
  "tsx",
  "jsx",
  "html",
  "css",
  "go",
  "rs",
] as const;
const ALL_SUPPORTED_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...TEXT_EXTENSIONS,
];
const IMAGE_EXTENSION_SET = new Set(IMAGE_EXTENSIONS.map((extension) => `.${extension}`));
const DOCUMENT_EXTENSION_SET = new Set(
  DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`)
);
const TEXT_EXTENSION_SET = new Set(TEXT_EXTENSIONS.map((extension) => `.${extension}`));
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".xml": "application/xml",
  ".py": "text/x-python",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".jsx": "text/jsx",
  ".html": "text/html",
  ".css": "text/css",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
};

function getAttachmentCategory(
  extension: string
): FileAttachment["category"] | null {
  if (IMAGE_EXTENSION_SET.has(extension)) {
    return "image";
  }

  if (DOCUMENT_EXTENSION_SET.has(extension)) {
    return "document";
  }

  if (TEXT_EXTENSION_SET.has(extension)) {
    return "text";
  }

  return null;
}

function buildFileAttachment(filePath: string): FileAttachment | null {
  try {
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = MIME_MAP[extension];
    const category = getAttachmentCategory(extension);

    if (!mimeType || !category) {
      return null;
    }

    const stats = statSync(filePath);

    if (!stats.isFile() || stats.size > MAX_ATTACHMENT_SIZE_BYTES) {
      return null;
    }

    const attachment: FileAttachment = {
      id: randomUUID(),
      name: path.basename(filePath),
      category,
      mimeType,
      size: stats.size,
      localPath: filePath,
    };

    if (category === "image") {
      attachment.base64Data = readFileSync(filePath).toString("base64");
    }

    return attachment;
  } catch (error) {
    console.warn(`[index] Failed to prepare attachment: ${filePath}`, error);
    return null;
  }
}

const RECOVERY_MAX_MESSAGES = 80;
const RECOVERY_MAX_TRANSCRIPT_CHARS = 100_000;
const RECOVERY_MAX_TOOL_IO_CHARS = 4_000;
let isQuitting = false;

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
  forwardEvent: (payload: AgentStreamEvent) => void,
  workspaceId = "default",
  attachments?: FileAttachment[]
) {
  const sdkCliPath = resolveSDKCliPath();
  const currentPrompt = text.trim();
  const existingSDKSessionId = await getSdkSessionId(sessionId, workspaceId);
  const workspacePath = await getWorkspacePath(workspaceId);
  const persistedMessages = existingSDKSessionId
    ? []
    : await loadMessages(sessionId, workspaceId);
  const shouldRecoverFromTranscript =
    !existingSDKSessionId && persistedMessages.length > 1;
  const initialPrompt = shouldRecoverFromTranscript
    ? buildRecoveredPromptFromMessages(persistedMessages, currentPrompt)
    : currentPrompt;

  if (shouldRecoverFromTranscript) {
    console.warn(
      `[index] Local session ${sessionId} has persisted history but no stored SDK session. Rebuilding context from local transcript.`
    );
  }

  const profile = await buildProductivityProfile({
    userPrompt: initialPrompt,
    cwd: workspacePath,
    sdkCliPath,
    onEvent: forwardEvent,
    isFirstTurn: !existingSDKSessionId && !shouldRecoverFromTranscript,
    sessionId: existingSDKSessionId,
  });

  try {
    await runAgentWithProfile(sessionId, profile, forwardEvent, attachments, workspaceId);
  } catch (error) {
    if (!(error instanceof MissingSdkSessionError) || !existingSDKSessionId) {
      throw error;
    }

    console.warn(
      `[index] Stored SDK session ${existingSDKSessionId} is unavailable for local session ${sessionId}. Rebuilding context from local transcript.`
    );

    await clearSdkSessionId(sessionId, workspaceId);
    const recoveredMessages =
      persistedMessages.length > 0 ? persistedMessages : await loadMessages(sessionId, workspaceId);
    const rebuiltPrompt = buildRecoveredPromptFromMessages(recoveredMessages, currentPrompt);
    const recoveredProfile = await buildProductivityProfile({
      userPrompt: rebuiltPrompt,
      cwd: workspacePath,
      sdkCliPath,
      onEvent: forwardEvent,
      isFirstTurn: false,
      sessionId: undefined,
    });

    await runAgentWithProfile(
      sessionId,
      recoveredProfile,
      forwardEvent,
      attachments,
      workspaceId
    );
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f5f3f0",
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

  ipcMain.handle("provider:list", () => {
    return providerManager.list();
  });

  ipcMain.handle("provider:create", async (_event, input: unknown) => {
    return providerManager.create(parseProviderCreateInput(input));
  });

  ipcMain.handle("provider:update", async (_event, id: unknown, input: unknown) => {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error("A valid providerId is required.");
    }

    return providerManager.update(id, parseProviderUpdateInput(input));
  });

  ipcMain.handle("provider:delete", async (_event, id: unknown) => {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error("A valid providerId is required.");
    }

    await providerManager.delete(id);
  });

  ipcMain.handle("provider:set-default", async (_event, providerId: unknown) => {
    if (typeof providerId !== "string" || providerId.trim().length === 0) {
      throw new Error("A valid providerId is required.");
    }

    await providerManager.setDefault(providerId);
  });

  ipcMain.handle("provider:get-api-key", async (_event, providerId: unknown) => {
    if (typeof providerId !== "string" || providerId.trim().length === 0) {
      throw new Error("A valid providerId is required.");
    }

    return providerManager.decryptApiKey(providerId);
  });

  ipcMain.handle("provider:has-configured", () => {
    return providerManager.hasConfigured();
  });

  ipcMain.handle(
    "provider:test",
    async (_event, baseUrl: unknown, apiKey: unknown, modelId?: unknown) => {
      if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
        throw new Error("A valid baseUrl is required.");
      }
      if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
        throw new Error("A valid apiKey is required.");
      }
      if (modelId !== undefined && typeof modelId !== "string") {
        throw new Error("modelId must be a string when provided.");
      }

      return providerManager.testConnection(baseUrl, apiKey, modelId);
    }
  );

  ipcMain.handle("provider:test-default", () => {
    return providerManager.testDefaultConnection();
  });

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

  ipcMain.handle("workspace:list", async () => {
    return listWorkspaces();
  });

  ipcMain.handle(
    "workspace:create",
    async (_event, name: unknown, workspacePath: unknown) => {
      if (typeof name !== "string" || name.trim().length === 0) {
        throw new Error("Workspace name is required.");
      }
      if (typeof workspacePath !== "string" || workspacePath.trim().length === 0) {
        throw new Error("Workspace path is required.");
      }

      const workspace = await createWorkspace(name.trim(), workspacePath.trim());
      console.log(`[index] Workspace created: ${workspace.id} (${workspace.path})`);
      return workspace;
    }
  );

  ipcMain.handle("workspace:delete", async (_event, workspaceId: unknown) => {
    const targetWorkspaceId = resolveWorkspaceId(workspaceId);

    if (targetWorkspaceId === "default") {
      throw new Error("Default workspace cannot be deleted.");
    }

    await deleteWorkspace(targetWorkspaceId);
    console.log(`[index] Workspace deleted: ${targetWorkspaceId}`);
  });

  ipcMain.handle("workspace:pick-directory", async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, {
          properties: ["openDirectory", "createDirectory"],
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        });

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("session:list", async (_event, workspaceId: unknown) => {
    return listSessions(resolveWorkspaceId(workspaceId));
  });

  ipcMain.handle("session:create", async (_event, title: string, workspaceId: unknown) => {
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new Error("Session title is required.");
    }

    return createSession(title.trim(), resolveWorkspaceId(workspaceId));
  });

  ipcMain.handle("session:delete", async (_event, sessionId: unknown, workspaceId: unknown) => {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new Error("A valid sessionId is required.");
    }

    await deleteSession(sessionId, resolveWorkspaceId(workspaceId));
    console.log(`[index] Session deleted: ${sessionId}`);
  });

  ipcMain.handle(
    "session:rename",
    async (_event, sessionId: unknown, title: unknown, workspaceId: unknown) => {
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        throw new Error("A valid sessionId is required.");
      }
      if (typeof title !== "string" || title.trim().length === 0) {
        throw new Error("A non-empty title is required.");
      }

      const nextTitle = title.trim();
      await renameSession(sessionId, nextTitle, resolveWorkspaceId(workspaceId));
      console.log(`[index] Session renamed: ${sessionId} -> "${nextTitle}"`);
    }
  );

  ipcMain.handle(
    "session:load-messages",
    async (_event, sessionId: string, workspaceId: unknown) => {
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new Error("Session ID is required.");
      }

      return loadMessages(sessionId, resolveWorkspaceId(workspaceId));
    }
  );

  ipcMain.handle("dialog:select-files", async (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "All Supported", extensions: [...ALL_SUPPORTED_EXTENSIONS] },
        { name: "Images", extensions: [...IMAGE_EXTENSIONS] },
        { name: "Documents", extensions: [...DOCUMENT_EXTENSIONS] },
        { name: "Text & Code", extensions: [...TEXT_EXTENSIONS] },
      ],
    };
    const { canceled, filePaths } = targetWindow
      ? await dialog.showOpenDialog(targetWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (canceled || filePaths.length === 0) {
      return [];
    }

    return filePaths
      .map((filePath) => buildFileAttachment(filePath))
      .filter((attachment): attachment is FileAttachment => attachment !== null);
  });

  ipcMain.handle("file:read-as-attachment", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      return null;
    }

    return buildFileAttachment(filePath);
  });

  ipcMain.handle(
    "agent:chat",
    async (
      event,
      text: unknown,
      sessionId: unknown,
      workspaceId: unknown,
      attachments?: FileAttachment[]
    ) => {
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error("A non-empty prompt is required.");
      }
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        throw new Error("A valid sessionId is required.");
      }

      const targetWorkspaceId = resolveWorkspaceId(workspaceId);

      if (isAgentRunningForSession(sessionId)) {
        throw new Error(`An agent is already running for session ${sessionId}.`);
      }

      console.log(
        `[index] Current mode: productivity, workspace: ${targetWorkspaceId}, session: ${sessionId}`
      );

      await updateSessionMeta(sessionId, {}, targetWorkspaceId);
      const savedAttachments =
        attachments && attachments.length > 0
          ? await saveAttachments(sessionId, attachments, targetWorkspaceId)
          : [];

      await appendMessageRecord(
        sessionId,
        {
          kind: "user",
          message: {
            id: `user-${randomUUID()}`,
            role: "user",
            type: "text",
            text: text.trim(),
            thinking: "",
            status: "done",
            attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
          },
        },
        targetWorkspaceId
      );
      memoryAgent.scheduleProcessing(sessionId, targetWorkspaceId);

      const target = event.sender;
      const forwardEvent = (payload: AgentStreamEvent) => {
        if (!target.isDestroyed()) {
          target.send("agent:stream", { ...payload, sessionId });
        }

        const message = payload as Record<string, unknown>;

        if (message.type === "assistant" && "message" in message) {
          persistAssistantMessage(sessionId, message.message, targetWorkspaceId);
        }

        if (message.type === "user" && "message" in message) {
          persistToolResults(sessionId, message.message, targetWorkspaceId);
        }
      };

      void startProductivityRun(
        sessionId,
        text.trim(),
        forwardEvent,
        targetWorkspaceId,
        attachments
      ).catch((err) => {
        console.error(`[index] Agent run failed for session ${sessionId}:`, err);
      });
    }
  );

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

app.on("before-quit", async (event) => {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  event.preventDefault();

  try {
    await memoryAgent.flushAll();
  } catch (error) {
    console.error("[main] Memory flush on quit failed:", error);
  } finally {
    app.exit();
  }
});
