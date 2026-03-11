import { contextBridge, ipcRenderer } from "electron";
import type { AgentStreamEvent, ZoraApi } from "../shared/zora";

const zoraApi: ZoraApi = {
  getAppVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>,
  chat: (text: string) => ipcRenderer.invoke("agent:chat", text) as Promise<void>,
  onStream: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AgentStreamEvent) => {
      callback(payload);
    };

    ipcRenderer.on("agent:stream", listener);

    return () => {
      ipcRenderer.removeListener("agent:stream", listener);
    };
  },
  stopAgent: () => ipcRenderer.invoke("agent:stop") as Promise<void>
};

contextBridge.exposeInMainWorld("zora", zoraApi);
