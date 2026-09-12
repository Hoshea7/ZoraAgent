import { cp, mkdir, mkdtemp, readFile, rm, symlink, lstat, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";

it("reopens an offline snapshot in another data root with managed files, preserved skill links and native Pi state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zora-guided-restore-"));
  const oldRoot = path.join(root, "source", ".zora");
  const newRoot = path.join(root, "target", ".zora");
  try {
    vi.resetModules();
    vi.stubEnv("ZORA_HOME", oldRoot);
    const source = await import("@/main/session-store");
    const session = await source.createSession("待迁移的会话");
    await source.appendMessageRecord(session.id, { kind: "user", message: { id: "old-user", role: "user", text: `历史里的旧路径保留：${oldRoot}`, timestamp: 1 } });
    await writeFile(path.join(session.workingDirectory!, "work.txt"), "OWNED-WORK-271");
    const originalSkill = path.join(root, "source-skill");
    await mkdir(originalSkill);
    const skillText = "---\nname: restore-check\ndescription: Verify a restored skill\n---\nActual skill body";
    await writeFile(path.join(originalSkill, "SKILL.md"), skillText);
    await mkdir(path.join(oldRoot, "skills"), { recursive: true });
    await symlink(originalSkill, path.join(oldRoot, "skills", "restore-check"));
    await mkdir(path.join(oldRoot, "state"), { recursive: true });
    await writeFile(path.join(oldRoot, "state", "skill-registry.json"), JSON.stringify({ version: 1, skills: { "restore-check": { source: { type: "imported", fromTool: "test", method: "symlink", originalPath: originalSkill }, installedAt: 1 } } }));
    const runtimeDir = path.join(oldRoot, "workspaces", "default", "sessions", "runtime", "pi", session.id);
    const checkpoint = SessionManager.create(session.workingDirectory!, runtimeDir, { id: session.id });
    checkpoint.appendMessage({ role: "user", content: "Remember MOVE-CONTEXT-527", timestamp: 1 });
    checkpoint.appendMessage({ role: "assistant", content: [{ type: "text", text: "MOVE-CONTEXT-527" }], api: "openai-completions", provider: "test", model: "test", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 });
    checkpoint.appendCustomEntry("zora.turn-cursor", { userMessageId: "old-user" });
    const checkpointPath = checkpoint.getSessionFile()!;
    const checkpointBytes = await readFile(checkpointPath, "utf8");
    const indexRelative = path.join("workspaces", "default", "sessions", "index.json");
    const oldIndex = await readFile(path.join(oldRoot, indexRelative), "utf8");

    // This is the guide's explicit offline copy, not an application import API.
    // No target data exists. A populated target is never silently merged here.
    await expect(access(newRoot)).rejects.toThrow();
    await cp(oldRoot, newRoot, { recursive: true, dereference: false, errorOnExist: true, force: false });
    const newDirectory = path.join(newRoot, path.relative(oldRoot, session.workingDirectory!));
    vi.resetModules();
    vi.stubEnv("ZORA_HOME", newRoot);
    const target = await import("@/main/session-store");
    expect(await target.requireSessionDirectory(session.id)).toBe(newDirectory);
    expect(await readFile(path.join(newDirectory, "work.txt"), "utf8")).toBe("OWNED-WORK-271");
    expect((await target.loadMessages(session.id))[0].text).toContain(oldRoot);
    expect(await readFile(path.join(oldRoot, indexRelative), "utf8")).toBe(oldIndex);
    expect((await lstat(path.join(oldRoot, "skills", "restore-check"))).isSymbolicLink()).toBe(true);
    expect((await lstat(path.join(newRoot, "skills", "restore-check"))).isSymbolicLink()).toBe(true);
    await rm(originalSkill, { recursive: true });
    expect((await (await import("@/main/skill-manager")).listSkills()).some((skill) => skill.name === "restore-check")).toBe(false);
    const movedCheckpoint = path.join(newRoot, path.relative(oldRoot, checkpointPath));
    expect(await readFile(movedCheckpoint, "utf8")).toBe(checkpointBytes);
    const reopened = SessionManager.open(movedCheckpoint, path.dirname(movedCheckpoint), newDirectory);
    expect(reopened.getCwd()).toBe(newDirectory);
    expect(reopened.buildSessionContext()).toEqual(checkpoint.buildSessionContext());
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(root, { recursive: true, force: true });
  }
});
