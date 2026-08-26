import type { SessionMeta, WorkspaceMeta } from "../../shared/zora";

export type {
  AssistantAction,
  AssistantTurn,
  BodySegment,
  ConversationMessage,
  FileAttachment,
  ProcessStep,
  ResponseAnnotation,
  ResponseAnnotationAnchor,
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskDetailLink,
  ScheduledTaskSchedule,
  ScheduledTaskStatus,
  ScheduledTaskUpdateInput,
  ThinkingBlock,
  ToolAction,
} from "../../shared/zora";

// 工作区类型
export type Workspace = WorkspaceMeta;

// 会话类型
export type Session = SessionMeta;
