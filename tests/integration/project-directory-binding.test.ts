import { mkdtemp, mkdir, readFile, writeFile, rename, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PROJECT_DIRECTORY_UNAVAILABLE } from "@/shared/project-directory";

let root: string;
let data: string;
let store: typeof import("@/main/workspace-store");
let sessions: typeof import("@/main/session-store");

beforeEach(async () => {
  vi.resetModules();
  root = await mkdtemp(path.join(tmpdir(), "zora-binding-int-"));
  data = path.join(root, ".zora");
  vi.stubEnv("ZORA_HOME", data);
  store = await import("@/main/workspace-store");
  sessions = await import("@/main/session-store");
});
afterEach(async () => { vi.unstubAllEnvs(); vi.resetModules(); await rm(root, { recursive: true, force: true }); });

async function project() {
  const directory = path.join(root, "project");
  await mkdir(directory);
  const workspace = await store.createWorkspace("项目", directory);
  const session = await sessions.createSession("旧会话", workspace.id);
  await sessions.appendMessageRecord(session.id, {
    kind: "user", message: { id: "user-1", role: "user", text: `历史记录 ${directory}`, timestamp: 1 },
  }, workspace.id);
  return { workspace, session, directory };
}

it("relinks existing, archived and shared session directories without altering history or Pi checkpoints", async () => {
  const { workspace, session, directory } = await project();
  const index = path.join(data, "workspaces", workspace.id, "sessions", "index.json");
  const original = JSON.parse(await readFile(index, "utf8"));
  const child = { ...session, id: "child", parentSessionId: session.id, workingDirectoryOwnerSessionId: session.id, archivedAt: "2026-09-12" };
  await writeFile(index, JSON.stringify([...original, child,
    { ...session, id: "nested", workingDirectory: path.join(directory, "nested") },
    { ...session, id: "independent", workingDirectory: path.join(root, "independent") },
    { ...session, id: "claude", agentRuntimeType: "claude", sdkSessionId: "old-sdk" },
  ]));
  const checkpoint = path.join(data, "workspaces", workspace.id, "sessions", "runtime", "pi", session.id, "checkpoint.jsonl");
  await mkdir(path.dirname(checkpoint), { recursive: true });
  await writeFile(checkpoint, "original checkpoint");
  const nextDirectory = path.join(root, "moved");
  await rename(directory, nextDirectory);
  const rebound = await store.updateWorkspace(workspace.id, { name: workspace.name, directory: nextDirectory }, () => false);
  expect(rebound.id).toBe(workspace.id);
  const updated = await sessions.listSessions(workspace.id, { includeArchived: true });
  expect(updated[0].workingDirectory).toBe(nextDirectory);
  expect(updated[1]).toMatchObject({ ...child, workingDirectory: nextDirectory });
  expect(updated[2].workingDirectory).toBe(path.join(nextDirectory, "nested"));
  expect(updated[3].workingDirectory).toBe(path.join(root, "independent"));
  expect(updated[4].sdkSessionId).toBeUndefined();
  expect(await sessions.requireSessionDirectory(session.id, workspace.id)).toBe(nextDirectory);
  await expect(sessions.requireSessionDirectory("nested", workspace.id)).rejects.toThrow(PROJECT_DIRECTORY_UNAVAILABLE);
  expect((await sessions.loadMessages(session.id, workspace.id))[0].text).toBe(`历史记录 ${directory}`);
  expect(await readFile(checkpoint, "utf8")).toBe("original checkpoint");
  expect(JSON.parse(await readFile(path.join(data, "workspaces", workspace.id, "workspace.json"), "utf8")).path).toBe(nextDirectory);
  vi.resetModules();
  expect((await (await import("@/main/workspace-store")).listWorkspaces()).find((item) => item.id === workspace.id)?.path).toBe(nextDirectory);
});

it("does not recreate missing project or existing managed-session directories", async () => {
  const { workspace, session, directory } = await project();
  await rm(directory, { recursive: true });
  await expect(store.createWorkspace("不存在", directory)).rejects.toThrow(PROJECT_DIRECTORY_UNAVAILABLE);
  await expect(sessions.createSession("不应创建", workspace.id)).rejects.toThrow(PROJECT_DIRECTORY_UNAVAILABLE);
  await expect(sessions.getSessionWorkingDirectory(session.id, workspace.id)).rejects.toThrow(PROJECT_DIRECTORY_UNAVAILABLE);
  await expect(access(directory)).rejects.toThrow();
  expect(await sessions.listSessions(workspace.id)).toHaveLength(1);
  const managed = await sessions.createSession("托管");
  await rm(managed.workingDirectory!, { recursive: true });
  await expect(sessions.getSessionWorkingDirectory(managed.id)).rejects.toThrow(PROJECT_DIRECTORY_UNAVAILABLE);
  await expect(access(managed.workingDirectory!)).rejects.toThrow();
});

it("rejects an active project and invalid replacement without changing its binding", async () => {
  const { workspace, directory } = await project();
  const next = path.join(root, "next");
  await mkdir(next);
  await expect(store.updateWorkspace(workspace.id, { name: workspace.name, directory: next }, () => true)).rejects.toThrow("项目正在运行");
  await expect(store.updateWorkspace(workspace.id, { name: workspace.name, directory: path.join(root, "absent") }, () => false)).rejects.toThrow(PROJECT_DIRECTORY_UNAVAILABLE);
  expect((await store.listWorkspaces()).find((item) => item.id === workspace.id)?.path).toBe(directory);
});

it("restores all binding files from an interrupted commit before listing projects", async () => {
  const { workspace } = await project();
  const indexPath = path.join(data, "workspaces.json");
  const sidecarPath = path.join(data, "workspaces", workspace.id, "workspace.json");
  const sessionPath = path.join(data, "workspaces", workspace.id, "sessions", "index.json");
  const journal = {
    workspaceId: workspace.id,
    workspaceIndex: await readFile(indexPath, "utf8"),
    sidecar: await readFile(sidecarPath, "utf8"),
    sessionIndex: await readFile(sessionPath, "utf8"),
  };
  await writeFile(path.join(data, "workspace-binding-operation.json"), JSON.stringify(journal));
  await writeFile(indexPath, "[]");
  await writeFile(sidecarPath, "{}");
  await writeFile(sessionPath, "[]");
  vi.resetModules();
  const reopened = await import("@/main/workspace-store");
  expect((await reopened.listWorkspaces()).find((item) => item.id === workspace.id)?.path).toBe(workspace.path);
  expect(await readFile(sessionPath, "utf8")).toBe(journal.sessionIndex);
  expect(await readFile(sidecarPath, "utf8")).toBe(journal.sidecar);
  await expect(access(path.join(data, "workspace-binding-operation.json"))).rejects.toThrow();
});

it("rejects forks into an unavailable project before saving data", async () => {
  const { workspace, session, directory } = await project();
  const sessionDirectory = path.join(data, "workspaces", workspace.id, "sessions");
  const historyPath = path.join(sessionDirectory, `${session.id}.jsonl`);
  const originalHistory = await readFile(historyPath, "utf8");
  const originalIndex = await readFile(path.join(sessionDirectory, "index.json"), "utf8");
  await rm(directory, { recursive: true });
  const { forkSessionFromSource } = await import("@/main/session-fork");
  await expect(forkSessionFromSource({ workspaceId: workspace.id, sourceSessionId: session.id })).rejects.toThrow(PROJECT_DIRECTORY_UNAVAILABLE);
  expect(await readFile(historyPath, "utf8")).toBe(originalHistory);
  expect(await readFile(path.join(sessionDirectory, "index.json"), "utf8")).toBe(originalIndex);
  await expect(access(directory)).rejects.toThrow();
});

it("rolls back a failed binding write and leaves the original project usable", async () => {
  const { workspace, directory } = await project();
  const next = path.join(root, "next");
  await mkdir(next);
  const files = [path.join(data, "workspaces.json"), path.join(data, "workspaces", workspace.id, "workspace.json"), path.join(data, "workspaces", workspace.id, "sessions", "index.json")];
  const original = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const fs = await import("@/main/utils/fs");
  const replace = fs.replaceFileAtomically;
  let failed = false;
  const spy = vi.spyOn(fs, "replaceFileAtomically").mockImplementation(async (file, content) => {
    if (file === files[1] && !failed) { failed = true; throw new Error("injected write failure"); }
    await replace(file, content);
  });
  try { await expect(store.updateWorkspace(workspace.id, { name: workspace.name, directory: next }, () => false)).rejects.toThrow("injected write failure"); }
  finally { spy.mockRestore(); }
  expect(await Promise.all(files.map((file) => readFile(file, "utf8")))).toEqual(original);
  expect((await store.listWorkspaces()).find((item) => item.id === workspace.id)?.path).toBe(directory);
  await expect(access(path.join(data, "workspace-binding-operation.json"))).rejects.toThrow();
});

it("blocks session mutations while rollback is pending and resumes after recovery", async () => {
  const { workspace, session } = await project();
  const next = path.join(root, "next");
  await mkdir(next);
  const fs = await import("@/main/utils/fs");
  const replace = fs.replaceFileAtomically;
  const sidecar = path.join(data, "workspaces", workspace.id, "workspace.json");
  const spy = vi.spyOn(fs, "replaceFileAtomically").mockImplementation(async (file, content) => {
    if (file === sidecar) throw new Error("disk write unavailable");
    await replace(file, content);
  });
  await expect(store.updateWorkspace(workspace.id, { name: workspace.name, directory: next }, () => false)).rejects.toThrow("disk write unavailable");
  await expect(sessions.updateSessionMeta(session.id, { title: "must not overwrite rollback" }, workspace.id)).rejects.toThrow("项目正在运行");
  spy.mockRestore();
  await store.listWorkspaces();
  await sessions.updateSessionMeta(session.id, { title: "Recovered" }, workspace.id);
  expect((await sessions.getSessionMeta(session.id, workspace.id))?.title).toBe("Recovered");
});

it("saves project name and directory together and preserves both on failure", async () => {
  const { workspace, session, directory } = await project();
  const next = path.join(root, "new-location");
  await mkdir(next);
  await expect(store.updateWorkspace(workspace.id, { name: "修改后的名称", directory: path.join(root, "missing") }, () => false)).rejects.toThrow(PROJECT_DIRECTORY_UNAVAILABLE);
  expect((await store.listWorkspaces()).find((item) => item.id === workspace.id)).toMatchObject({ name: workspace.name, path: directory });
  const updated = await store.updateWorkspace(workspace.id, { name: "  修改后的名称  ", directory: next }, () => false);
  expect(updated).toMatchObject({ id: workspace.id, name: "修改后的名称", path: next });
  expect(await sessions.requireSessionDirectory(session.id, workspace.id)).toBe(next);
  await expect(store.updateWorkspace(workspace.id, { name: "  ", directory: next }, () => false)).rejects.toThrow("请输入项目名称");
});

it("allows editing only the project name when its directory is unavailable", async () => {
  const { workspace, directory, session } = await project();
  await rm(directory, { recursive: true });
  const updated = await store.updateWorkspace(workspace.id, { name: "仅修改名称", directory }, () => false);
  expect(updated).toMatchObject({ name: "仅修改名称", path: directory });
  expect((await sessions.loadMessages(session.id, workspace.id))[0].text).toContain("历史记录");
  await expect(access(directory)).rejects.toThrow();
});

it("runs a directoryless conversation without rebinding or recreating the missing project", async () => {
  const { workspace, session, directory } = await project();
  await rm(directory, { recursive: true });
  const before = await readFile(path.join(data, "workspaces", workspace.id, "sessions", "index.json"), "utf8");
  const execution = await sessions.getSessionExecutionDirectory(session, workspace.id);
  expect(execution.startsWith(data + path.sep)).toBe(true);
  await expect(access(execution)).resolves.toBeUndefined();
  await expect(access(directory)).rejects.toThrow();
  expect(await readFile(path.join(data, "workspaces", workspace.id, "sessions", "index.json"), "utf8")).toBe(before);
  await mkdir(directory);
  expect(await sessions.getSessionExecutionDirectory(session, workspace.id)).toBe(directory);
  await sessions.deleteSession(session.id, workspace.id);
  await expect(access(execution)).rejects.toThrow();
  await expect(access(directory)).resolves.toBeUndefined();
});
