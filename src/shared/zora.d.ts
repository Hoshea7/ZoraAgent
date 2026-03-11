export type AgentStatus = "started" | "finished" | "stopped";

export type AgentControlEvent =
  | {
      type: "agent_status";
      status: AgentStatus;
    }
  | {
      type: "agent_error";
      error: string;
    };

export type AgentStreamEvent = AgentControlEvent | ({ type: string } & Record<string, unknown>);

export interface ZoraApi {
  getAppVersion: () => Promise<string>;
  chat: (text: string) => Promise<void>;
  onStream: (callback: (event: AgentStreamEvent) => void) => () => void;
  stopAgent: () => Promise<void>;
}

declare global {
  interface Window {
    zora: ZoraApi;
  }
}

export {};
