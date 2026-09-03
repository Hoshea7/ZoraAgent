import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "@/renderer/types";
import {
  findActiveConversationTurnId,
  getConversationTurnMarkerScale,
  getConversationTurnPreview,
  getNavigableConversationTurns,
} from "@/renderer/utils/conversation-turn-navigation";

describe("conversation turn navigation", () => {
  it("keeps accepted user messages as turns and excludes pending or assistant messages", () => {
    const messages: ConversationMessage[] = [
      { id: "user-1", role: "user", text: "第一轮", timestamp: 1 },
      { id: "assistant-1", role: "assistant", text: "回复", timestamp: 2 },
      {
        id: "user-pending",
        role: "user",
        text: "排队消息",
        queueState: "pending",
        timestamp: 3,
      },
      {
        id: "user-2",
        role: "user",
        text: "第二轮",
        queueState: "accepted",
        timestamp: 4,
      },
    ];

    expect(getNavigableConversationTurns(messages).map((message) => message.id)).toEqual([
      "user-1",
      "user-2",
    ]);
  });

  it("builds compact previews for text, attachments, and annotations", () => {
    expect(
      getConversationTurnPreview({
        id: "text",
        role: "user",
        text: "  帮我\n整理一下   这段内容  ",
        timestamp: 1,
      })
    ).toBe("帮我 整理一下 这段内容");
    expect(
      getConversationTurnPreview({
        id: "images",
        role: "user",
        attachments: [
          { id: "image-1", name: "a.png", category: "image", size: 1 },
          { id: "image-2", name: "b.png", category: "image", size: 1 },
        ],
        timestamp: 1,
      })
    ).toBe("上传了 2 张图片");
    expect(
      getConversationTurnPreview({
        id: "annotations",
        role: "user",
        responseAnnotations: [
          {
            id: "annotation-1",
            anchor: { selectedText: "原文", start: 0, end: 2 },
            comment: "修改意见",
            createdAt: 1,
          },
        ],
        timestamp: 1,
      })
    ).toBe("提交了 1 条批注");
  });

  it("selects the latest turn above the viewport activation line", () => {
    const positions = [
      { id: "turn-1", offsetTop: 20 },
      { id: "turn-2", offsetTop: 280 },
      { id: "turn-3", offsetTop: 700 },
    ];

    expect(findActiveConversationTurnId(positions, 10)).toBe("turn-1");
    expect(findActiveConversationTurnId(positions, 300)).toBe("turn-2");
    expect(findActiveConversationTurnId(positions, 900)).toBe("turn-3");
    expect(findActiveConversationTurnId([], 300)).toBeNull();
  });

  it("keeps markers equal at rest and creates a peak around the selected turn", () => {
    expect(getConversationTurnMarkerScale(0, null)).toBe(1);
    expect(getConversationTurnMarkerScale(4, null)).toBe(1);

    expect(getConversationTurnMarkerScale(3, 3)).toBe(3.25);
    expect(getConversationTurnMarkerScale(2, 3)).toBe(2.3);
    expect(getConversationTurnMarkerScale(1, 3)).toBe(1.55);
    expect(getConversationTurnMarkerScale(0, 3)).toBe(1.15);
    expect(getConversationTurnMarkerScale(7, 3)).toBe(1);
  });
});
