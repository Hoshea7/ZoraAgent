// 消息状态类型
export type ChatMessageStatus = "streaming" | "done" | "stopped" | "error";

// 聊天消息类型
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking: string;
  status: ChatMessageStatus;
  error?: string;
};

// 工作区类型
export type Workspace = {
  id: string;
  name: string;
  icon?: string;
};

// 会话类型
export type Session = {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
};

// 分组会话类型
export type GroupedSessions = {
  pinned: Session[];
  today: Session[];
  earlier: Session[];
};

// 模式类型
export type Mode = "chat" | "agent";
