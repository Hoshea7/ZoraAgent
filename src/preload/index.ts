import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AgentStreamEvent,
  AskUserResponse,
  ChatMessage,
  FileAttachment,
  PermissionMode,
  PermissionResponse,
  SessionMeta,
  SkillMeta,
  WorkspaceMeta,
  ZoraApi,
} from "../shared/zora";
import {
  FEISHU_IPC,
  type FeishuBridgeStatus,
  type FeishuConfig,
  type FeishuConnectionTestResult,
} from "../shared/types/feishu";
import type {
  ProviderConfig,
  ProviderCreateInput,
  ProviderTestResult,
  ProviderUpdateInput,
} from "../shared/types/provider";

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
    startBridge: () => ipcRenderer.invoke(FEISHU_IPC.START_BRIDGE) as Promise<void>,
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
  },
  chat: (
    text: string,
    sessionId: string,
    workspaceId?: string,
    attachments?: FileAttachment[]
  ) =>
    ipcRenderer.invoke("agent:chat", text, sessionId, workspaceId, attachments) as Promise<void>,
  listSkills: () =>
    ipcRenderer.invoke("skill:list") as Promise<SkillMeta[]>,
  openSkillsDir: () =>
    ipcRenderer.invoke("skill:open-dir") as Promise<void>,
  openSkillDir: (dirName: string) =>
    ipcRenderer.invoke("skill:open-skill-dir", dirName) as Promise<void>,
  listSessions: (workspaceId?: string) =>
    ipcRenderer.invoke("session:list", workspaceId) as Promise<SessionMeta[]>,
  loadMessages: (sessionId: string, workspaceId?: string) =>
    ipcRenderer.invoke("session:load-messages", sessionId, workspaceId) as Promise<ChatMessage[]>,
  createSession: (title: string, workspaceId?: string) =>
    ipcRenderer.invoke("session:create", title, workspaceId) as Promise<SessionMeta>,
  deleteSession: (sessionId: string, workspaceId?: string) =>
    ipcRenderer.invoke("session:delete", sessionId, workspaceId) as Promise<void>,
  renameSession: (sessionId: string, title: string, workspaceId?: string) =>
    ipcRenderer.invoke("session:rename", sessionId, title, workspaceId) as Promise<void>,
  listWorkspaces: () =>
    ipcRenderer.invoke("workspace:list") as Promise<WorkspaceMeta[]>,
  createWorkspace: (name: string, workspacePath: string) =>
    ipcRenderer.invoke("workspace:create", name, workspacePath) as Promise<WorkspaceMeta>,
  deleteWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke("workspace:delete", workspaceId) as Promise<void>,
  pickWorkspaceDirectory: () =>
    ipcRenderer.invoke("workspace:pick-directory") as Promise<string | null>,
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
