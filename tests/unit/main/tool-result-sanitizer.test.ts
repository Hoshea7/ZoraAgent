import { describe, expect, it } from "vitest";
import { sanitizeToolResultContent } from "@/main/session-store";

describe("sanitizeToolResultContent", () => {
  it("persists text blocks and removes image bytes", () => {
    const result = sanitizeToolResultContent([
      { type: "text", text: "inspection summary" },
      { type: "image", data: "A".repeat(20_000), mimeType: "image/png" },
    ]);

    expect(result).toBe("inspection summary");
    expect(result).not.toContain("AAAA");
  });

  it("preserves plain string tool results", () => {
    expect(sanitizeToolResultContent("plain result")).toBe("plain result");
  });
});
