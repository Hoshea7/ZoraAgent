export type {
  ChatMessageStatus,
  ChatMessageType,
  ChatToolStatus,
  ChatMessage,
  FileAttachment,
} from "../../shared/zora";

// 工作区类型
export type Workspace = {
  id: string;
  name: string;
  icon?: string;
};

// 会话类型
export type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sdkSessionId?: string;
};

// 分组会话类型
export type GroupedSessions = {
  pinned: Session[];
  today: Session[];
  earlier: Session[];
};

// 模式类型
export type Mode = "chat" | "agent";
