export interface FeishuConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  autoStart: boolean;
  defaultWorkspaceId?: string;
}

export type FeishuChatType = "p2p" | "group";

export interface FeishuChatBinding {
  chatId: string;
  userId: string;
  sessionId: string;
  workspaceId: string;
  chatType: FeishuChatType;
  createdAt: number;
}

export interface FeishuBridgeStatus {
  status: "stopped" | "starting" | "running" | "error";
  error: string | null;
  botName: string | null;
}

export interface FeishuAgentStatePayload {
  sessionId: string;
  running: boolean;
}

export interface FeishuConnectionTestResult {
  success: boolean;
  error: string | null;
  botName: string | null;
}

export const FEISHU_IPC = {
  GET_CONFIG: "feishu:get-config",
  SAVE_CONFIG: "feishu:save-config",
  TEST_CONNECTION: "feishu:test-connection",
  START_BRIDGE: "feishu:start-bridge",
  STOP_BRIDGE: "feishu:stop-bridge",
  GET_STATUS: "feishu:get-status",
  STATUS_CHANGED: "feishu:status-changed",
  AGENT_STATE: "feishu:agent-state",
  LIST_BINDINGS: "feishu:list-bindings",
  REMOVE_BINDING: "feishu:remove-binding",
} as const;
