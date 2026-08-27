import { createStore } from "jotai";
import {
  draftResponseAnnotationsAtom,
  setDraftResponseAnnotationAtom,
} from "@/renderer/store/chat";
import { currentSessionIdAtom } from "@/renderer/store/workspace";
import type { ResponseAnnotation } from "@/shared/zora";

function annotation(
  id: string,
  sourceMessageId: string,
  startOffset: number,
  endOffset: number,
  comment?: string,
): ResponseAnnotation {
  return {
    id,
    sourceMessageId,
    anchor: {
      startOffset,
      endOffset,
      selectedText: `${startOffset}-${endOffset}`,
    },
    comment,
  };
}

describe("response annotation drafts", () => {
  it("keeps drafts scoped to the active session", () => {
    const store = createStore();
    store.set(currentSessionIdAtom, "session-a");
    store.set(
      setDraftResponseAnnotationAtom,
      annotation("a-1", "assistant-a", 0, 4),
    );

    store.set(currentSessionIdAtom, "session-b");
    expect(store.get(draftResponseAnnotationsAtom)).toEqual([]);
    store.set(
      setDraftResponseAnnotationAtom,
      annotation("b-1", "assistant-b", 5, 9),
    );

    store.set(currentSessionIdAtom, "session-a");
    expect(store.get(draftResponseAnnotationsAtom)).toEqual([
      expect.objectContaining({ id: "a-1" }),
    ]);
  });

  it("updates an exact range and retains partially overlapping ranges", () => {
    const store = createStore();
    store.set(currentSessionIdAtom, "session-a");
    store.set(
      setDraftResponseAnnotationAtom,
      annotation("first", "assistant-a", 0, 8, "旧评论"),
    );
    store.set(
      setDraftResponseAnnotationAtom,
      annotation("replacement", "assistant-a", 0, 8, "新评论"),
    );
    store.set(
      setDraftResponseAnnotationAtom,
      annotation("overlap", "assistant-a", 4, 12),
    );

    expect(store.get(draftResponseAnnotationsAtom)).toEqual([
      expect.objectContaining({ id: "replacement", comment: "新评论" }),
      expect.objectContaining({ id: "overlap" }),
    ]);
  });

  it("rejects annotations from a second assistant message", () => {
    const store = createStore();
    store.set(currentSessionIdAtom, "session-a");
    store.set(
      setDraftResponseAnnotationAtom,
      annotation("first", "assistant-a", 0, 4),
    );

    expect(() =>
      store.set(
        setDraftResponseAnnotationAtom,
        annotation("second", "assistant-b", 0, 4),
      ),
    ).toThrow("请先发送或清空当前批注");
  });

  it("normalizes comments at the draft write boundary", () => {
    const store = createStore();
    store.set(currentSessionIdAtom, "session-a");

    store.set(
      setDraftResponseAnnotationAtom,
      annotation("first", "assistant-a", 0, 4, "  精简表达  "),
    );

    expect(store.get(draftResponseAnnotationsAtom)[0]?.comment).toBe("精简表达");
  });
});
