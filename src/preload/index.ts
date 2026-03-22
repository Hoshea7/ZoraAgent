import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AgentRunInfo,
  AgentStreamEvent,
  AskUserResponse,
  ConversationMessage,
  FileAttachment,
  FileTreeEntry,
  PermissionMode,
  PermissionResponse,
  SessionMeta,
  SkillMeta,
  WorkspaceMeta,
  ZoraApi,
} from "../shared/zora";
import {
  FEISHU_IPC,
  type FeishuAgentStatePayload,
  type FeishuBridgeStatus,
  type FeishuConfig,
  type FeishuConnectionTestResult,
} from "../shared/types/feishu";
import type { MemorySettings } from "../shared/types/memory";
import type {
  DiscoveryResult,
  ExternalToolConfig,
  ImportMethod,
  ImportResult,
  ImportSelection,
} from "../shared/types/skill";
import type {
  ProviderConfig,
  ProviderCreateInput,
  ProviderTestResult,
  ProviderTestResultWithRoles,
  RoleModels,
  ProviderUpdateInput,
} from "../shared/types/provider";
import type {
  McpConfig,
  McpSaveInput,
  McpSaveResult,
  McpServerEntry,
  McpServerTestResult,
} from "../shared/types/mcp";

const zoraApi: ZoraApi = {
  getAppVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>,
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
  testProvider: (baseUrl: string, apiKey: string, modelId?: string) =>
    ipcRenderer.invoke("provider:test", baseUrl, apiKey, modelId) as Promise<ProviderTestResult>,
  testProviderWithRoleModels: (
    baseUrl: string,
    apiKey: string,
    modelId?: string,
    roleModels?: RoleModels
  ) =>
    ipcRenderer.invoke(
      "provider:test-with-roles",
      baseUrl,
      apiKey,
      modelId,
      roleModels
    ) as Promise<ProviderTestResultWithRoles>,
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
    ipcRenderer.invoke("session:list", workspaceId) as Promise<SessionMeta[]>,
  loadMessages: (sessionId: string, workspaceId?: string) =>
    ipcRenderer.invoke("session:load-messages", sessionId, workspaceId) as Promise<ConversationMessage[]>,
  createSession: (title: string, workspaceId?: string) =>
    ipcRenderer.invoke("session:create", title, workspaceId) as Promise<SessionMeta>,
  deleteSession: (sessionId: string, workspaceId?: string) =>
    ipcRenderer.invoke("session:delete", sessionId, workspaceId) as Promise<void>,
  renameSession: (sessionId: string, title: string, workspaceId?: string) =>
    ipcRenderer.invoke("session:rename", sessionId, title, workspaceId) as Promise<void>,
  switchSessionModel: (sessionId: string, modelId: string) =>
    ipcRenderer.invoke("session:switch-model", sessionId, modelId) as Promise<{
      success: boolean;
    }>,
  listWorkspaces: () =>
    ipcRenderer.invoke("workspace:list") as Promise<WorkspaceMeta[]>,
  createWorkspace: (name: string, workspacePath: string) =>
    ipcRenderer.invoke("workspace:create", name, workspacePath) as Promise<WorkspaceMeta>,
  deleteWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke("workspace:delete", workspaceId) as Promise<void>,
  pickWorkspaceDirectory: () =>
    ipcRenderer.invoke("workspace:pick-directory") as Promise<string | null>,
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
  awaken: (text: string) => ipcRenderer.invoke("agent:awaken", text) as Promise<void>,
  awakeningComplete: () => ipcRenderer.invoke("agent:awakening-complete") as Promise<void>,
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
  isAwakened: () => ipcRenderer.invoke("zora:is-awakened") as Promise<boolean>,
  setPermissionMode: (mode: PermissionMode) =>
    ipcRenderer.invoke("agent:permission-mode:set", mode) as Promise<void>,
  selectFiles: () => ipcRenderer.invoke("dialog:select-files"),
  readFileAsAttachment: (filePath: string) =>
    ipcRenderer.invoke("file:read-as-attachment", filePath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  respondPermission: (response: PermissionResponse) =>
    ipcRenderer.invoke("agent:permission:respond", response) as Promise<void>,
  respondAskUser: (response: AskUserResponse) =>
    ipcRenderer.invoke("agent:ask-user:respond", response) as Promise<void>,
};

contextBridge.exposeInMainWorld("zora", zoraApi);
