import {
  DEFAULT_RESPONSE_ANNOTATION_PROMPT,
  formatUserMessageForRuntime,
  normalizeResponseAnnotations,
  resolveUserMessageText,
} from "../../../src/shared/response-annotations";

describe("response annotations", () => {
  const annotation = {
    id: "annotation-1",
    sourceMessageId: "assistant-1",
    anchor: {
      startOffset: 8,
      endOffset: 12,
      selectedText: "原文<&",
    },
    comment: "  修改 <这里>  ",
  };

  it("normalizes comments and sorts annotations by source position", () => {
    const result = normalizeResponseAnnotations([
      annotation,
      {
        ...annotation,
        id: "annotation-2",
        anchor: { startOffset: 1, endOffset: 3, selectedText: "前文" },
        comment: "   ",
      },
    ]);

    expect(result).toEqual([
      {
        id: "annotation-2",
        sourceMessageId: "assistant-1",
        anchor: { startOffset: 1, endOffset: 3, selectedText: "前文" },
        comment: undefined,
      },
      {
        ...annotation,
        comment: "修改 <这里>",
      },
    ]);
  });

  it("rejects annotations from more than one assistant message", () => {
    expect(() =>
      normalizeResponseAnnotations([
        annotation,
        { ...annotation, id: "annotation-2", sourceMessageId: "assistant-2" },
      ])
    ).toThrow("one source message");
  });

  it("rejects duplicate annotation ids and invalid ranges", () => {
    expect(() => normalizeResponseAnnotations([annotation, annotation])).toThrow(
      "Duplicate response annotation id"
    );
    expect(() =>
      normalizeResponseAnnotations([
        { ...annotation, anchor: { ...annotation.anchor, endOffset: 8 } },
      ])
    ).toThrow("endOffset must exceed startOffset");
  });

  it("uses the visible default prompt only when annotations exist", () => {
    expect(resolveUserMessageText("", [annotation])).toBe(
      DEFAULT_RESPONSE_ANNOTATION_PROMPT
    );
    expect(resolveUserMessageText("  自定义要求  ", [annotation])).toBe(
      "自定义要求"
    );
    expect(resolveUserMessageText("", undefined)).toBe("");
  });

  it("formats selected text and comments for runtime without leaking XML", () => {
    const formatted = formatUserMessageForRuntime({
      text: "",
      responseAnnotations: [annotation],
    });

    expect(formatted).toContain(DEFAULT_RESPONSE_ANNOTATION_PROMPT);
    expect(formatted).toContain(
      "<selected_text>原文&lt;&amp;</selected_text>"
    );
    expect(formatted).toContain(
      "<comment>  修改 &lt;这里&gt;  </comment>"
    );
  });

  it("omits the comment element for an empty comment", () => {
    const formatted = formatUserMessageForRuntime({
      text: "整体问题",
      responseAnnotations: [{ ...annotation, comment: undefined }],
    });

    expect(formatted).toContain("整体问题");
    expect(formatted).not.toContain("<comment>");
  });
});
