export const DRAFT_SESSION_ID = "__draft__";

/**
 * 无活跃会话时，草稿按工作区隔离，避免切换工作区丢失输入内容。
 */
export function draftKeyForWorkspace(workspaceId: string): string {
  return `${DRAFT_SESSION_ID}:${workspaceId}`;
}
