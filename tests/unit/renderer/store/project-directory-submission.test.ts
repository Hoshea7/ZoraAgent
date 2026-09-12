import { createStore } from "jotai";
import {
  rejectDirectorySubmissionAtom, sessionMessagesAtom, sessionDraftsAtom,
  sessionDraftAttachmentsAtom,
} from "@/renderer/store/chat";
import { currentSessionIdAtom } from "@/renderer/store/workspace";
import type { FileAttachment } from "@/shared/zora";

it("restores rejected input to its own session without deleting history or newer drafts", () => {
  const store = createStore();
  const attachment: FileAttachment = { id: "file-1", name: "draft.txt", category: "text", mimeType: "text/plain", size: 3, localPath: "/isolated/draft.txt" };
  const history = { id: "old", role: "user" as const, text: "历史", timestamp: 1 };
  store.set(sessionMessagesAtom, { source: [history, { id: "optimistic", role: "user", text: "原草稿", timestamp: 2 }] });
  store.set(sessionDraftsAtom, { source: "刚写的新内容", other: "另一个会话的草稿" });
  store.set(sessionDraftAttachmentsAtom, { source: [attachment] });
  store.set(currentSessionIdAtom, "other");
  store.set(rejectDirectorySubmissionAtom, { sessionId: "source", messageId: "optimistic", text: "原草稿", attachments: [attachment], responseAnnotations: [] });
  expect(store.get(sessionMessagesAtom).source).toEqual([history]);
  expect(store.get(sessionDraftsAtom)).toEqual({ source: "原草稿\n\n刚写的新内容", other: "另一个会话的草稿" });
  expect(store.get(sessionDraftAttachmentsAtom).source).toEqual([attachment]);
});
