import type { WorkspaceMeta } from "../../shared/zora";

export type {
  AssistantTurn,
  BodySegment,
  ConversationMessage,
  FileAttachment,
  ProcessStep,
  ThinkingBlock,
  ToolAction,
} from "../../shared/zora";

// 工作区类型
export type Workspace = WorkspaceMeta;

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
