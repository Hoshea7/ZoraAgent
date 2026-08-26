import { describe, expect, it } from "vitest";
import { buildRecoveredPromptFromMessages } from "@/main/productivity-runner";

describe("productivity transcript recovery", () => {
  it("rebuilds image history using attachment IDs without bytes or paths", async () => {
    const prompt = await buildRecoveredPromptFromMessages([{
      id: "user-1",
      role: "user",
      text: "remember this",
      timestamp: 1,
      attachments: [{
        id: "attachment-id-1",
        name: "photo.png",
        category: "image",
        mimeType: "image/png",
        size: 3,
        localPath: "/private/secret/photo.png",
        base64Data: "AQID",
      }],
    }], "fallback");

    expect(prompt).toContain("attachmentId: attachment-id-1");
    expect(prompt).not.toContain("AQID");
    expect(prompt).not.toContain("/private/secret");
  });

  it("rebuilds response annotations as structured user context", async () => {
    const prompt = await buildRecoveredPromptFromMessages(
      [
        {
          id: "user-annotation",
          role: "user",
          text: "请基于以下评论批注内容给出反馈。",
          timestamp: 1,
          responseAnnotations: [
            {
              id: "annotation-1",
              sourceMessageId: "assistant-1",
              anchor: {
                startOffset: 0,
                endOffset: 4,
                selectedText: "原文内容",
              },
              comment: "调整整体结论",
            },
          ],
        },
      ],
      "fallback",
    );

    expect(prompt).toContain("<response_annotations>");
    expect(prompt).toContain("<selected_text>原文内容</selected_text>");
    expect(prompt).toContain("<comment>调整整体结论</comment>");
  });
});
