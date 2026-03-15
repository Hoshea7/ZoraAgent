import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AgentStreamEvent,
  ZoraApi,
  PermissionResponse,
  AskUserResponse,
  PermissionMode,
  ChatMessage,
  FileAttachment,
  SessionMeta,
} from "../shared/zora";

const zoraApi: ZoraApi = {
  getAppVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>,
  chat: (text: string, sessionId: string, attachments?: FileAttachment[]) =>
    ipcRenderer.invoke("agent:chat", text, sessionId, attachments) as Promise<void>,
  listSessions: () =>
    ipcRenderer.invoke("session:list") as Promise<SessionMeta[]>,
  loadMessages: (sessionId: string) =>
    ipcRenderer.invoke("session:load-messages", sessionId) as Promise<ChatMessage[]>,
  createSession: (title: string) =>
    ipcRenderer.invoke("session:create", title) as Promise<SessionMeta>,
  deleteSession: (sessionId: string) =>
    ipcRenderer.invoke("session:delete", sessionId) as Promise<void>,
  renameSession: (sessionId: string, title: string) =>
    ipcRenderer.invoke("session:rename", sessionId, title) as Promise<void>,
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
