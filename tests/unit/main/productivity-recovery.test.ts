import { describe, expect, it } from "vitest";
import { buildRecoveredPromptFromMessages } from "@/main/productivity-runner";

describe("productivity transcript recovery", () => {
  it("rebuilds image history using attachment IDs without bytes or paths", () => {
    const prompt = buildRecoveredPromptFromMessages([{
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
});
