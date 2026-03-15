import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentStreamEvent,
  ZoraApi,
  PermissionResponse,
  AskUserResponse,
  PermissionMode,
  ChatMessage,
  SkillMeta,
  SessionMeta,
} from "../shared/zora";

const zoraApi: ZoraApi = {
  getAppVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>,
  chat: (text: string, sessionId: string) =>
    ipcRenderer.invoke("agent:chat", text, sessionId) as Promise<void>,
  listSkills: () =>
    ipcRenderer.invoke("skill:list") as Promise<SkillMeta[]>,
  openSkillsDir: () =>
    ipcRenderer.invoke("skill:open-dir") as Promise<void>,
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
  respondPermission: (response: PermissionResponse) =>
    ipcRenderer.invoke("agent:permission:respond", response) as Promise<void>,
  respondAskUser: (response: AskUserResponse) =>
    ipcRenderer.invoke("agent:ask-user:respond", response) as Promise<void>,
};

contextBridge.exposeInMainWorld("zora", zoraApi);
