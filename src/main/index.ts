import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type {
  AgentStreamEvent,
  AskUserResponse,
  FileAttachment,
  PermissionMode,
  PermissionResponse,
} from "../shared/zora";
import { FEISHU_IPC, type FeishuConfig } from "../shared/types/feishu";
import type { ImportMethod, ImportResult, ImportSelection } from "../shared/types/skill";
import type { ProviderCreateInput, ProviderUpdateInput } from "../shared/types/provider";
import {
  getAgentRunInfo,
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
import { memoryAgent } from "./memory-agent";
import { ensureBootstrapScaffold } from "./memory-store";
import {
  feishuBridge,
  loadFeishuConfig,
  saveFeishuConfig,
  testFeishuConnection,
} from "./feishu";
import { isBootstrapMode } from "./prompt-builder";
import { runProductivitySession } from "./productivity-runner";
import {
  buildAwakeningProfile,
} from "./query-profiles";
import { providerManager } from "./provider-manager";
import {
  appendMessageRecord,
  createSession,
  deleteSession,
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
  listWorkspaces,
} from "./workspace-store";
import {
  GLOBAL_SKILLS_DIR,
  listSkills,
  seedBundledSkills,
  uninstallSkill,
} from "./skill-manager";
import {
  discoverExternalSkills,
  importSkill,
  importSkills,
  listExternalTools,
} from "./skill-discovery";

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

function assertRequiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
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

function truncateForPreview(value: string, maxChars = 200): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...(${value.length} chars)`;
}

function summarizeToolUseResult(value: unknown): unknown {
  if (!isRecord(value)) {
    if (typeof value === "string") {
      return truncateForPreview(value);
    }

    return value;
  }

  const summary: Record<string, unknown> = {
    keys: Object.keys(value),
  };

  if (typeof value.type === "string") {
    summary.type = value.type;
  }

  if (typeof value.filePath === "string") {
    summary.filePath = value.filePath;
  }

  if (typeof value.file_path === "string") {
    summary.file_path = value.file_path;
  }

  if ("content" in value) {
    const content =
      typeof value.content === "string"
        ? value.content
        : JSON.stringify(value.content ?? "");
    summary.contentLength = content.length;
    summary.contentPreview = truncateForPreview(content);
  }

  if (Array.isArray(value.structuredPatch)) {
    summary.structuredPatchCount = value.structuredPatch.length;
  }

  if (typeof value.originalFile === "string") {
    summary.originalFileLength = value.originalFile.length;
  }

  return summary;
}

function stripAssistantToolInputs(message: unknown): unknown {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return message;
  }

  let changed = false;
  const compactContent = message.content.map((block) => {
    if (!isRecord(block) || block.type !== "tool_use" || !("input" in block)) {
      return block;
    }

    changed = true;
    const { input: _input, ...rest } = block;
    return rest;
  });

  if (!changed) {
    return message;
  }

  return {
    ...message,
    content: compactContent,
  };
}

function compactEventForRenderer(payload: AgentStreamEvent): AgentStreamEvent {
  if (!isRecord(payload)) {
    return payload;
  }

  if (payload.type === "user" && "tool_use_result" in payload) {
    return {
      ...payload,
      tool_use_result: summarizeToolUseResult(payload.tool_use_result),
    } as AgentStreamEvent;
  }

  if (payload.type === "assistant" && "message" in payload) {
    const compactMessage = stripAssistantToolInputs(payload.message);
    if (compactMessage !== payload.message) {
      return {
        ...payload,
        message: compactMessage,
      } as AgentStreamEvent;
    }
  }

  return payload;
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

function parseFeishuConnectionInput(input: unknown): { appId: string; appSecret: string } {
  if (!isRecord(input)) {
    throw new Error("A valid feishu test payload is required.");
  }

  return {
    appId: assertRequiredString(input.appId, "feishu.appId"),
    appSecret: assertRequiredString(input.appSecret, "feishu.appSecret"),
  };
}

function parseOptionalFeishuConfigInput(input: unknown): FeishuConfig | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!isRecord(input)) {
    throw new Error("A valid feishu config payload is required.");
  }

  return input as unknown as FeishuConfig;
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

let isQuitting = false;
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

  ipcMain.handle(FEISHU_IPC.GET_CONFIG, () => {
    return loadFeishuConfig();
  });

  ipcMain.handle(FEISHU_IPC.SAVE_CONFIG, async (_event, input: unknown) => {
    return saveFeishuConfig(input as FeishuConfig);
  });

  ipcMain.handle(FEISHU_IPC.TEST_CONNECTION, async (_event, input: unknown) => {
    const { appId, appSecret } = parseFeishuConnectionInput(input);
    return testFeishuConnection(appId, appSecret);
  });

  ipcMain.handle(FEISHU_IPC.START_BRIDGE, async (_event, input?: unknown) => {
    return feishuBridge.start(parseOptionalFeishuConfigInput(input));
  });

  ipcMain.handle(FEISHU_IPC.STOP_BRIDGE, async () => {
    await feishuBridge.stop();
  });

  ipcMain.handle(FEISHU_IPC.GET_STATUS, () => {
    return feishuBridge.getStatus();
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

  ipcMain.handle("skill:discover", async () => {
    return discoverExternalSkills();
  });

  ipcMain.handle(
    "skill:import",
    async (
      _event,
      sourcePath: unknown,
      method: unknown,
      sourceTool: unknown,
      dirName?: unknown
    ) => {
      if (typeof sourcePath !== "string" || sourcePath.trim().length === 0) {
        throw new Error("A valid sourcePath is required.");
      }
      if (method !== "symlink" && method !== "copy") {
        throw new Error('method must be "symlink" or "copy".');
      }
      if (typeof sourceTool !== "string" || sourceTool.trim().length === 0) {
        throw new Error("A valid sourceTool is required.");
      }
      const targetDirName =
        dirName !== undefined && dirName !== null
          ? assertRequiredString(dirName, "dirName")
          : undefined;

      return importSkill(
        sourcePath.trim(),
        method as ImportMethod,
        sourceTool.trim(),
        targetDirName
      );
    }
  );

  ipcMain.handle("skill:import-batch", async (_event, selections: unknown) => {
    if (!Array.isArray(selections)) {
      throw new Error("selections must be an array.");
    }

    const validSelections: Array<{ index: number; selection: ImportSelection }> = [];
    const results: Array<ImportResult | null> = new Array(selections.length).fill(null);

    for (const [index, item] of selections.entries()) {
      if (typeof item !== "object" || item === null) {
        results[index] = {
          dirName: `selection-${index + 1}`,
          success: false,
          error: "Each selection must be an object.",
        };
        continue;
      }

      const sel = item as Record<string, unknown>;

      const dirName =
        typeof sel.dirName === "string" && sel.dirName.trim().length > 0
          ? sel.dirName.trim()
          : typeof sel.sourcePath === "string" && sel.sourcePath.trim().length > 0
            ? path.basename(sel.sourcePath.trim())
            : `selection-${index + 1}`;

      if (typeof sel.sourcePath !== "string" || sel.sourcePath.trim().length === 0) {
        results[index] = {
          dirName,
          success: false,
          error: "Each selection requires a valid sourcePath.",
        };
        continue;
      }

      if (sel.method !== "symlink" && sel.method !== "copy") {
        results[index] = {
          dirName,
          success: false,
          error: 'Each selection.method must be "symlink" or "copy".',
        };
        continue;
      }

      if (typeof sel.sourceTool !== "string" || sel.sourceTool.trim().length === 0) {
        results[index] = {
          dirName,
          success: false,
          error: "Each selection requires a valid sourceTool.",
        };
        continue;
      }

      validSelections.push({
        index,
        selection: {
          dirName,
          sourcePath: sel.sourcePath.trim(),
          sourceTool: sel.sourceTool.trim(),
          method: sel.method,
        },
      });
    }

    const validResults = await importSkills(validSelections.map((item) => item.selection));
    for (const [resultIndex, result] of validResults.entries()) {
      results[validSelections[resultIndex].index] = result;
    }

    return results.filter((result): result is ImportResult => result !== null);
  });

  ipcMain.handle("skill:uninstall", async (_event, dirName: unknown) => {
    if (
      typeof dirName !== "string" ||
      dirName.trim().length === 0 ||
      path.basename(dirName) !== dirName
    ) {
      throw new Error("A valid skill directory name is required.");
    }
    return uninstallSkill(dirName);
  });

  ipcMain.handle("skill:list-external-tools", () => {
    return listExternalTools();
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
            text: text.trim(),
            timestamp: Date.now(),
            attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
          },
        },
        targetWorkspaceId
      );
      memoryAgent.scheduleProcessing(sessionId, targetWorkspaceId);

      const target = event.sender;
      const forwardEvent = (payload: AgentStreamEvent) => {
        if (!target.isDestroyed()) {
          target.send("agent:stream", {
            ...compactEventForRenderer(payload),
            sessionId,
          });
        }

        const message = payload as Record<string, unknown>;

        if (message.type === "assistant" && "message" in message) {
          persistAssistantMessage(sessionId, message.message, targetWorkspaceId);
        }

        if (message.type === "user" && "message" in message) {
          persistToolResults(sessionId, message.message, targetWorkspaceId);
        }
      };

      void runProductivitySession({
        sessionId,
        text: text.trim(),
        forwardEvent,
        workspaceId: targetWorkspaceId,
        attachments,
        source: "desktop",
      }).catch((err) => {
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
        target.send("agent:stream", {
          ...compactEventForRenderer(payload),
          sessionId: "__awakening__",
        });
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

    await runAgentWithProfile("__awakening__", profile, forwardEvent, undefined, "default", "awakening");
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

  ipcMain.handle("agent:is-running", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new Error("A valid sessionId is required.");
    }

    return isAgentRunningForSession(sessionId.trim());
  });

  ipcMain.handle("agent:get-run-info", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new Error("A valid sessionId is required.");
    }

    return getAgentRunInfo(sessionId.trim());
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
