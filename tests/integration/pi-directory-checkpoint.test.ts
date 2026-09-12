import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

it("keeps native history and compaction while opening a persisted Pi checkpoint in a new directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zora-pi-rebinding-"));
  try {
    const previous = path.join(root, "old");
    const next = path.join(root, "new");
    const sessionDir = path.join(root, "sessions");
    await Promise.all([mkdir(previous), mkdir(next)]);
    const manager = SessionManager.create(previous, sessionDir);
    manager.appendMessage({ role: "user", content: "Remember project token ALPHA", timestamp: 1 });
    manager.appendMessage({
      role: "assistant", content: [{ type: "text", text: "Remembered ALPHA" }],
      api: "openai-completions", provider: "test", model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: 2,
    });
    const kept = manager.appendMessage({ role: "user", content: "Continue working", timestamp: 3 });
    manager.appendCompaction("Project token is ALPHA", kept, 12000);
    manager.appendCustomEntry("zora.turn-cursor", { userMessageId: "user-2" });
    const file = manager.getSessionFile()!;
    const before = await readFile(file, "utf8");
    const reopened = SessionManager.open(file, sessionDir, next);
    expect(reopened.getCwd()).toBe(next);
    expect(reopened.getSessionId()).toBe(manager.getSessionId());
    expect(reopened.getEntries()).toEqual(manager.getEntries());
    expect(reopened.buildSessionContext()).toEqual(manager.buildSessionContext());
    expect(JSON.stringify(reopened.buildSessionContext())).toContain("ALPHA");
    expect(await readFile(file, "utf8")).toBe(before);
    reopened.appendMessage({ role: "user", content: "Read the new project", timestamp: 4 });
    expect(SessionManager.open(file, sessionDir, next).getEntries().length).toBe(manager.getEntries().length + 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
