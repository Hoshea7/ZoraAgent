import type { ConversationMessage } from "../types";

export const CONVERSATION_TURN_NAVIGATION_MIN_TURNS = 5;

export interface ConversationTurnPosition {
  id: string;
  offsetTop: number;
}

const TURN_MARKER_WAVE_SCALES = [3.25, 2.3, 1.55, 1.15] as const;

export function getConversationTurnMarkerScale(
  turnIndex: number,
  selectedTurnIndex: number | null
): number {
  if (selectedTurnIndex === null) {
    return 1;
  }

  return TURN_MARKER_WAVE_SCALES[Math.abs(turnIndex - selectedTurnIndex)] ?? 1;
}

export function getNavigableConversationTurns(
  messages: readonly ConversationMessage[]
): ConversationMessage[] {
  return messages.filter(
    (message) => message.role === "user" && message.queueState !== "pending"
  );
}

export function getConversationTurnPreview(message: ConversationMessage): string {
  const text = message.text?.replace(/\s+/g, " ").trim();
  if (text) {
    return text;
  }

  const attachments = message.attachments ?? [];
  if (attachments.length > 0) {
    const imageCount = attachments.filter(
      (attachment) => attachment.category === "image"
    ).length;
    if (imageCount === attachments.length) {
      return `上传了 ${imageCount} 张图片`;
    }
    if (imageCount === 0) {
      return `上传了 ${attachments.length} 个文件`;
    }
    return `上传了 ${attachments.length} 个附件`;
  }

  const annotationCount = message.responseAnnotations?.length ?? 0;
  if (annotationCount > 0) {
    return `提交了 ${annotationCount} 条批注`;
  }

  return "用户消息";
}

export function findActiveConversationTurnId(
  positions: readonly ConversationTurnPosition[],
  activationLine: number
): string | null {
  if (positions.length === 0) {
    return null;
  }

  let activeId = positions[0].id;
  for (const position of positions) {
    if (position.offsetTop > activationLine) {
      break;
    }
    activeId = position.id;
  }
  return activeId;
}
