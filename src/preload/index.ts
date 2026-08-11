import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AgentRunInfo,
  AgentStreamEvent,
  ArchivedSessionEntry,
  AskUserQuestionAnswer,
  ClientLogEventInput,
  ConversationMessage,
  FileAttachment,
  FileTreeEntry,
  ForkSessionInput,
  PermissionMode,
  PermissionResponse,
  SessionModelLogContext,
  SessionForkResult,
  SessionMeta,
  SessionArchiveScope,
  SkillMeta,
  WorkspaceMeta,
  ZoraApi,
  DelegationScope,
  DelegationRef,
  SubtaskBlockedResponse,
  SubtaskRespondResult,
  SubtaskSummary,
} from "../shared/zora";
import {
  FEISHU_IPC,
  type FeishuAgentStatePayload,
  type FeishuBridgeStatus,
  type FeishuConfig,
  type FeishuConnectionTestResult,
} from "../shared/types/feishu";
import type { DefaultModelSettings } from "../shared/types/default-model";
import type { MemorySettings } from "../shared/types/memory";
import type { VisionSettings } from "../shared/types/vision";
import type {
  DiscoveryResult,
  ExternalToolConfig,
  ImportMethod,
  ImportResult,
  ImportSelection,
} from "../shared/types/skill";
import type { UpdateStatus } from "../shared/types/updater";
import type {
  ProviderConfig,
  ProviderCreateInput,
  ProviderProtocol,
  ProviderTestResult,
  ProviderTestResultWithRoles,
  ReasoningLevel,
  RoleModels,
  ProviderUpdateInput,
  AgentRuntimeType,
} from "../shared/types/provider";
import type {
  McpConfig,
  McpSaveInput,
  McpSaveResult,
  McpServerEntry,
  McpServerTestResult,
} from "../shared/types/mcp";
import type {
  ScheduledTask,
  ScheduledTaskUpdateInput,
} from "../shared/types/schedule";
import { SESSION_IPC, SUBTASK_IPC } from "../shared/types/ipc";

const zoraApi: ZoraApi = {
  getAppVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>,
  openExternal: (url: string) => ipcRenderer.invoke("app:open-external", url) as Promise<void>,
  logClientEvent: (input: ClientLogEventInput) =>
    ipcRenderer.invoke("diagnostic-log:client-event", input) as Promise<void>,
  subtask: {
    list: (scope: DelegationScope) =>
      ipcRenderer.invoke(SUBTASK_IPC.LIST, scope) as Promise<SubtaskSummary[]>,
    get: (input: DelegationRef) =>
      ipcRenderer.invoke(SUBTASK_IPC.GET, input) as Promise<SubtaskSummary | null>,
    stop: (input: DelegationRef & { expectedRunId: string }) =>
      ipcRenderer.invoke(SUBTASK_IPC.STOP, input) as Promise<SubtaskSummary>,
    respond: (input: DelegationRef & { blockedEventId: string; response: SubtaskBlockedResponse }) =>
      ipcRenderer.invoke(SUBTASK_IPC.RESPOND, input) as Promise<SubtaskRespondResult>,
  },
  updater: {
    getStatus: () => ipcRenderer.invoke("updater:get-status") as Promise<UpdateStatus>,
    checkForUpdates: () => ipcRenderer.invoke("updater:check") as Promise<UpdateStatus>,
    downloadUpdate: () => ipcRenderer.invoke("updater:download") as Promise<UpdateStatus>,
    installUpdate: () => ipcRenderer.invoke("updater:install") as Promise<void>,
    onStatusChanged: (callback: (status: UpdateStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: UpdateStatus) => {
        callback(payload);
      };

      ipcRenderer.on("updater:status", handler);

      return () => {
        ipcRenderer.removeListener("updater:status", handler);
      };
    },
  },
  listProviders: () =>
    ipcRenderer.invoke("provider:list") as Promise<ProviderConfig[]>,
  createProvider: (input: ProviderCreateInput) =>
    ipcRenderer.invoke("provider:create", input) as Promise<ProviderConfig>,
  updateProvider: (id: string, input: ProviderUpdateInput) =>
    ipcRenderer.invoke("provider:update", id, input) as Promise<ProviderConfig>,
  deleteProvider: (id: string) =>
    ipcRenderer.invoke("provider:delete", id) as Promise<void>,
  setDefaultProvider: (providerId: string) =>
    ipcRenderer.invoke("provider:set-default", providerId) as Promise<void>,
  getProviderApiKey: (providerId: string) =>
    ipcRenderer.invoke("provider:get-api-key", providerId) as Promise<string | null>,
  testProvider: (
    baseUrl: string,
    apiKey: string,
    modelId?: string,
    testRunId?: string,
    protocol?: ProviderProtocol
  ) =>
    ipcRenderer.invoke(
      "provider:test",
      baseUrl,
      apiKey,
      modelId,
      testRunId,
      protocol
    ) as Promise<ProviderTestResult>,
  testProviderWithRoleModels: (
    baseUrl: string,
    apiKey: string,
    modelId?: string,
    roleModels?: RoleModels,
    testRunId?: string,
    protocol?: ProviderProtocol
  ) =>
    ipcRenderer.invoke(
      "provider:test-with-roles",
      baseUrl,
      apiKey,
      modelId,
      roleModels,
      testRunId,
      protocol
    ) as Promise<ProviderTestResultWithRoles>,
  cancelProviderTest: (testRunId: string) =>
    ipcRenderer.invoke("provider:cancel-test", testRunId) as Promise<boolean>,
  testDefaultProvider: () =>
    ipcRenderer.invoke("provider:test-default") as Promise<ProviderTestResult>,
  hasConfiguredProvider: () =>
    ipcRenderer.invoke("provider:has-configured") as Promise<boolean>,
  feishu: {
    getConfig: () =>
      ipcRenderer.invoke(FEISHU_IPC.GET_CONFIG) as Promise<FeishuConfig | null>,
    saveConfig: (config: FeishuConfig) =>
      ipcRenderer.invoke(FEISHU_IPC.SAVE_CONFIG, config) as Promise<FeishuConfig>,
    testConnection: (params: { appId: string; appSecret: string }) =>
      ipcRenderer.invoke(FEISHU_IPC.TEST_CONNECTION, params) as Promise<FeishuConnectionTestResult>,
    startBridge: (config?: FeishuConfig) =>
      ipcRenderer.invoke(FEISHU_IPC.START_BRIDGE, config) as Promise<FeishuConfig>,
    stopBridge: () => ipcRenderer.invoke(FEISHU_IPC.STOP_BRIDGE) as Promise<void>,
    getStatus: () => ipcRenderer.invoke(FEISHU_IPC.GET_STATUS) as Promise<FeishuBridgeStatus>,
    onStatusChanged: (callback: (status: FeishuBridgeStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: FeishuBridgeStatus) => {
        callback(payload);
      };

      ipcRenderer.on(FEISHU_IPC.STATUS_CHANGED, handler);

      return () => {
        ipcRenderer.removeListener(FEISHU_IPC.STATUS_CHANGED, handler);
      };
    },
    onAgentStateChanged: (callback: (payload: FeishuAgentStatePayload) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: FeishuAgentStatePayload
      ) => {
        callback(payload);
      };

      ipcRenderer.on(FEISHU_IPC.AGENT_STATE, handler);

      return () => {
        ipcRenderer.removeListener(FEISHU_IPC.AGENT_STATE, handler);
      };
    },
  },
  memory: {
    getSettings: () =>
      ipcRenderer.invoke("memory:getSettings") as Promise<MemorySettings>,
    updateSettings: (settings: Partial<MemorySettings>) =>
      ipcRenderer.invoke("memory:updateSettings", settings) as Promise<MemorySettings>,
    processNow: () =>
      ipcRenderer.invoke("memory:processNow") as Promise<{
        total: number;
        processed: number;
      }>,
    getPendingCount: () =>
      ipcRenderer.invoke("memory:getPendingCount") as Promise<number>,
    onPendingChanged: (callback: (count: number) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, count: number) => {
        callback(count);
      };

      ipcRenderer.on("memory:pendingChanged", handler);

      return () => {
        ipcRenderer.removeListener("memory:pendingChanged", handler);
      };
    },
    getStatus: () =>
      ipcRenderer.invoke("memory:getStatus") as Promise<{ pending: number; processing: number }>,
  },
  defaultModel: {
    getSettings: () =>
      ipcRenderer.invoke("default-model:getSettings") as Promise<DefaultModelSettings>,
    updateSettings: (settings: Partial<DefaultModelSettings>) =>
      ipcRenderer.invoke("default-model:updateSettings", settings) as Promise<DefaultModelSettings>,
  },
  vision: {
    getSettings: () =>
      ipcRenderer.invoke("vision:getSettings") as Promise<VisionSettings>,
    updateSettings: (settings: VisionSettings) =>
      ipcRenderer.invoke("vision:updateSettings", settings) as Promise<VisionSettings>,
  },
  mcp: {
    getConfig: () => ipcRenderer.invoke("mcp:get-config") as Promise<McpConfig>,
    getEditableConfig: () => ipcRenderer.invoke("mcp:get-editable-config") as Promise<McpConfig>,
    save: (input: McpSaveInput) =>
      ipcRenderer.invoke("mcp:save", input) as Promise<McpSaveResult>,
    deleteServer: (name: string) =>
      ipcRenderer.invoke("mcp:delete-server", { name }) as Promise<McpConfig>,
    toggleServer: (name: string, enabled: boolean) =>
      ipcRenderer.invoke("mcp:toggle-server", { name, enabled }) as Promise<McpConfig>,
    testServer: (name: string, entry: McpServerEntry) =>
      ipcRenderer.invoke("mcp:test-server", { name, entry }) as Promise<McpServerTestResult>,
  },
  chat: (
    text: string,
    sessionId: string,
    workspaceId?: string,
    attachments?: FileAttachment[]
  ) =>
    ipcRenderer.invoke("agent:chat", text, sessionId, workspaceId, attachments) as Promise<void>,
  queueMessage: (
    sessionId: string,
    text: string,
    workspaceId?: string,
    uuid?: string,
    attachments?: FileAttachment[]
  ) =>
    ipcRenderer.invoke(
      "agent:queue-message",
      sessionId,
      text,
      workspaceId,
      uuid,
      attachments
    ) as Promise<string>,
  isAgentRunning: (sessionId: string) =>
    ipcRenderer.invoke("agent:is-running", sessionId) as Promise<boolean>,
  getAgentRunInfo: (sessionId: string) =>
    ipcRenderer.invoke("agent:get-run-info", sessionId) as Promise<AgentRunInfo>,
  listSkills: () =>
    ipcRenderer.invoke("skill:list") as Promise<SkillMeta[]>,
  openSkillsDir: () =>
    ipcRenderer.invoke("skill:open-dir") as Promise<void>,
  openSkillDir: (dirName: string) =>
    ipcRenderer.invoke("skill:open-skill-dir", dirName) as Promise<void>,
  discoverSkills: () =>
    ipcRenderer.invoke("skill:discover") as Promise<DiscoveryResult>,
  importSkill: (
    sourcePath: string,
    method: ImportMethod,
    sourceTool: string,
    dirName?: string
  ) =>
    ipcRenderer.invoke(
      "skill:import",
      sourcePath,
      method,
      sourceTool,
      dirName
    ) as Promise<ImportResult>,
  importSkills: (selections: ImportSelection[]) =>
    ipcRenderer.invoke("skill:import-batch", selections) as Promise<
      ImportResult[]
    >,
  uninstallSkill: (dirName: string) =>
    ipcRenderer.invoke("skill:uninstall", dirName) as Promise<void>,
  listExternalTools: () =>
    ipcRenderer.invoke("skill:list-external-tools") as Promise<
      ExternalToolConfig[]
    >,
  listSessions: (workspaceId?: string) =>
    ipcRenderer.invoke(SESSION_IPC.LIST, workspaceId) as Promise<SessionMeta[]>,
  listArchivedSessions: () =>
    ipcRenderer.invoke(SESSION_IPC.LIST_ARCHIVED) as Promise<ArchivedSessionEntry[]>,
  loadMessages: (sessionId: string, workspaceId?: string) =>
    ipcRenderer.invoke(SESSION_IPC.LOAD_MESSAGES, sessionId, workspaceId) as Promise<ConversationMessage[]>,
  getSessionFilePath: (sessionId: string, workspaceId?: string) =>
    ipcRenderer.invoke(SESSION_IPC.GET_FILE_PATH, sessionId, workspaceId) as Promise<string>,
  createSession: (
    title: string,
    workspaceId?: string,
    permissionMode?: PermissionMode
  ) =>
    ipcRenderer.invoke(
      SESSION_IPC.CREATE,
      title,
      workspaceId,
      permissionMode
    ) as Promise<SessionMeta>,
  forkSession: (input: ForkSessionInput) =>
    ipcRenderer.invoke(SESSION_IPC.FORK, input) as Promise<SessionForkResult>,
  archiveSession: (
    sessionId: string,
    workspaceId?: string,
    scope?: SessionArchiveScope
  ) =>
    ipcRenderer.invoke(
      SESSION_IPC.ARCHIVE,
      sessionId,
      workspaceId,
      scope
    ) as Promise<SessionMeta | null>,
  restoreSession: (sessionId: string, workspaceId?: string) =>
    ipcRenderer.invoke(SESSION_IPC.RESTORE, sessionId, workspaceId) as Promise<SessionMeta | null>,
  deleteSession: (sessionId: string, workspaceId?: string) =>
    ipcRenderer.invoke(SESSION_IPC.DELETE, sessionId, workspaceId) as Promise<void>,
  renameSession: (sessionId: string, title: string, workspaceId?: string) =>
    ipcRenderer.invoke(SESSION_IPC.RENAME, sessionId, title, workspaceId) as Promise<void>,
  lockSessionModel: (
    sessionId: string,
    providerId: string,
    modelId: string,
    workspaceId?: string,
    logContext?: SessionModelLogContext
  ) =>
    ipcRenderer.invoke(
      SESSION_IPC.LOCK_MODEL,
      sessionId,
      providerId,
      modelId,
      workspaceId,
      logContext
    ) as Promise<{
      success: boolean;
    }>,
  switchSessionModel: (
    sessionId: string,
    modelId: string,
    workspaceId?: string,
    logContext?: SessionModelLogContext
  ) =>
    ipcRenderer.invoke(
      SESSION_IPC.SWITCH_MODEL,
      sessionId,
      modelId,
      workspaceId,
      logContext
    ) as Promise<{
      success: boolean;
    }>,
  setSessionRuntime: (
    sessionId: string,
    agentRuntimeType: AgentRuntimeType,
    workspaceId?: string
  ) =>
    ipcRenderer.invoke(
      SESSION_IPC.SET_RUNTIME,
      sessionId,
      agentRuntimeType,
      workspaceId
    ) as Promise<void>,
  setSessionReasoningLevel: (
    sessionId: string,
    reasoningLevel: ReasoningLevel,
    workspaceId?: string
  ) =>
    ipcRenderer.invoke(
      SESSION_IPC.SET_REASONING_LEVEL,
      sessionId,
      reasoningLevel,
      workspaceId
    ) as Promise<void>,
  listWorkspaces: () =>
    ipcRenderer.invoke("workspace:list") as Promise<WorkspaceMeta[]>,
  createWorkspace: (name: string, workspacePath: string) =>
    ipcRenderer.invoke("workspace:create", name, workspacePath) as Promise<WorkspaceMeta>,
  deleteWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke("workspace:delete", workspaceId) as Promise<void>,
  renameWorkspace: (workspaceId: string, name: string) =>
    ipcRenderer.invoke("workspace:rename", workspaceId, name) as Promise<WorkspaceMeta>,
  pickWorkspaceDirectory: () =>
    ipcRenderer.invoke("workspace:pick-directory") as Promise<string | null>,
  listScheduledTasks: (workspaceId?: string) =>
    ipcRenderer.invoke("schedule:list", workspaceId) as Promise<ScheduledTask[]>,
  getScheduledTask: (taskId: string, workspaceId: string) =>
    ipcRenderer.invoke("schedule:get", taskId, workspaceId) as Promise<ScheduledTask | null>,
  updateScheduledTask: (input: ScheduledTaskUpdateInput) =>
    ipcRenderer.invoke("schedule:update", input) as Promise<ScheduledTask>,
  deleteScheduledTask: (taskId: string, workspaceId: string) =>
    ipcRenderer.invoke("schedule:delete", taskId, workspaceId) as Promise<void>,
  onScheduledTasksChanged: (callback: (workspaceId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, workspaceId: string) => {
      callback(workspaceId);
    };

    ipcRenderer.on("schedule:changed", handler);

    return () => {
      ipcRenderer.removeListener("schedule:changed", handler);
    };
  },
  filetree: {
    list: (dirPath: string, workspacePath: string) =>
      ipcRenderer.invoke("filetree:list", dirPath, workspacePath) as Promise<FileTreeEntry[]>,
    openInFinder: (dirPath: string) =>
      ipcRenderer.invoke("filetree:open-in-finder", dirPath) as Promise<void>,
    watch: (workspacePath: string) =>
      ipcRenderer.invoke("filetree:watch", workspacePath) as Promise<void>,
    unwatch: () =>
      ipcRenderer.invoke("filetree:unwatch") as Promise<void>,
    onChanged: (callback: () => void) => {
      const handler = () => callback();

      ipcRenderer.on("filetree:changed", handler);

      return () => {
        ipcRenderer.removeListener("filetree:changed", handler);
      };
    },
  },
  onStream: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AgentStreamEvent) => {
      callback(payload);
    };

    ipcRenderer.on("agent:stream", listener);

    return () => {
      ipcRenderer.removeListener("agent:stream", listener);
    };
  },
  stopAgent: (sessionId: string) =>
    ipcRenderer.invoke("agent:stop", sessionId) as Promise<void>,
  setPermissionMode: (
    sessionId: string,
    mode: PermissionMode,
    workspaceId?: string
  ) =>
    ipcRenderer.invoke(
      "agent:permission-mode:set",
      sessionId,
      mode,
      workspaceId
    ) as Promise<void>,
  selectFiles: () => ipcRenderer.invoke("dialog:select-files"),
  readFileAsAttachment: (filePath: string) =>
    ipcRenderer.invoke("file:read-as-attachment", filePath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  respondPermission: (response: PermissionResponse) =>
    ipcRenderer.invoke("agent:permission:respond", response) as Promise<void>,
  answerAskUserQuestion: (response: AskUserQuestionAnswer) =>
    ipcRenderer.invoke("agent:ask-user:respond", response) as Promise<void>,
};

contextBridge.exposeInMainWorld("zora", zoraApi);
