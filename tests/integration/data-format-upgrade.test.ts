import { access, cp, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

let root: string;
let data: string;
const oldRoot = String.raw`C:\Users\old\.zora`;
const oldProject = String.raw`D:\Projects\sample`;
const record = (id: string, extra = {}) => ({ id, title: id, createdAt: "2026-01-01", updatedAt: "2026-01-01", permissionMode: "ask", ...extra });
async function put(relative: string, value: unknown) {
  const file = path.join(data, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
}
async function seed() {
  await put("workspaces/.DS_Store", "Finder metadata");
  await put("workspaces.json", [
    record("default", { name: "默认", path: `${oldRoot}\\workspaces\\default\\files` }),
    record("p1", { name: "项目", path: oldProject }),
  ]);
  await put("workspaces/default/sessions/index.json", [record("s1", { workingDirectory: `${oldRoot}\\workspaces\\default\\files\\s1` }), record("legacy-home")]);
  await put("workspaces/default/sessions/s1.jsonl", JSON.stringify({ kind: "user", message: { id: "u1", role: "user", text: `Keep ${oldRoot}`, timestamp: 1 } }) + "\n");
  await put("workspaces/default/files/s1/work.txt", "PORTABLE-WORK");
  await put("workspaces/p1/sessions/index.json", [record("ps1", { workingDirectory: `${oldProject}\\nested`, archivedAt: "2026-02-01", agentRuntimeType: "pi" })]);
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "zora-format-"));
  data = path.join(root, ".zora");
  vi.resetModules();
  vi.stubEnv("ZORA_HOME", data);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); await rm(root, { recursive: true, force: true }); });

it("upgrades a Windows backup, rebinds its project, and moves the upgraded data again without rewriting paths", async () => {
  await seed();
  const originalIndex = await readFile(path.join(data, "workspaces/default/sessions/index.json"), "utf8");
  const store = await import("@/main/session-store");
  expect(await store.getSessionWorkingDirectory("s1")).toBe(path.join(data, "workspaces/default/files/s1"));
  const indexPath = path.join(data, "workspaces/default/sessions/index.json");
  const upgradedIndex = await readFile(indexPath, "utf8");
  expect(JSON.parse(upgradedIndex)[0]).toMatchObject({ directory: { kind: "data", path: "workspaces/default/files/s1" } });
  expect(JSON.parse(upgradedIndex)[0]).not.toHaveProperty("workingDirectory");
  expect((await store.getSessionMeta("legacy-home"))?.workingDirectory).toBe(String.raw`C:\Users\old`);
  const backup = JSON.parse(await readFile(path.join(data, "backups/directory-format-v1.json"), "utf8"));
  expect(backup.changes.find((c: { file: string }) => c.file === "workspaces/default/sessions/index.json").before).toBe(originalIndex);
  const project = path.join(root, "project");
  await mkdir(path.join(project, "nested"), { recursive: true });
  await (await import("@/main/workspace-store")).updateWorkspace("p1", { name: "新目录", directory: project }, () => false);
  expect(await store.getSessionWorkingDirectory("ps1", "p1")).toBe(path.join(project, "nested"));
  expect((await store.getSessionMeta("ps1", "p1"))?.archivedAt).toBe("2026-02-01");
  const target = path.join(root, "another-device", ".zora");
  await cp(data, target, { recursive: true });
  await rm(data, { recursive: true });
  vi.resetModules(); vi.stubEnv("ZORA_HOME", target);
  const moved = await import("@/main/session-store");
  const cwd = await moved.getSessionWorkingDirectory("s1");
  expect(cwd).toBe(path.join(target, "workspaces/default/files/s1"));
  expect(await readFile(path.join(cwd, "work.txt"), "utf8")).toBe("PORTABLE-WORK");
  expect((await moved.loadMessages("s1"))[0].text).toContain(oldRoot);
  expect(await readFile(path.join(target, "workspaces/default/sessions/index.json"), "utf8")).toBe(upgradedIndex);
  const fork = await moved.createForkedSession({ sourceSessionId: "s1", agentRuntimeType: "pi" });
  await moved.copySessionWorkingDirectory("s1", fork.id);
  expect(await readFile(path.join(fork.workingDirectory!, "work.txt"), "utf8")).toBe("PORTABLE-WORK");
  await moved.deleteSession("s1");
  await expect(access(cwd)).rejects.toThrow();
  expect(await readFile(path.join(fork.workingDirectory!, "work.txt"), "utf8")).toBe("PORTABLE-WORK");
});

it("restores original indexes on a failed conversion and completes the same upgrade on retry", async () => {
  await seed();
  const paths = ["workspaces.json", "workspaces/default/sessions/index.json", "workspaces/p1/sessions/index.json"];
  const originals = await Promise.all(paths.map((p) => readFile(path.join(data, p), "utf8")));
  const fs = await import("@/main/utils/fs");
  const write = fs.replaceFileAtomically;
  let failed = false;
  vi.spyOn(fs, "replaceFileAtomically").mockImplementation(async (file, content) => {
    if (!failed && file === path.join(data, "workspaces/p1/sessions/index.json")) { failed = true; throw new Error("disk unavailable"); }
    return write(file, content);
  });
  const { ensureDataFormat } = await import("@/main/data-format");
  await expect(ensureDataFormat()).rejects.toThrow("disk unavailable");
  expect(await Promise.all(paths.map((p) => readFile(path.join(data, p), "utf8")))).toEqual(originals);
  await expect(access(path.join(data, "data-format.json"))).rejects.toThrow();
  await ensureDataFormat();
  expect(JSON.parse(await readFile(path.join(data, "data-format.json"), "utf8"))).toEqual({ version: 2 });
  await expect(access(path.join(data, "data-upgrade.json"))).rejects.toThrow();
});

it("preserves a dangling bundled skill link while initializing other skills and opening history", async () => {
  await seed();
  await mkdir(path.join(data, "skills"), { recursive: true });
  const link = path.join(data, "skills", "pdf");
  const missing = path.join(root, "old-device", "pdf");
  await symlink(missing, link, "dir");
  const { seedBundledSkills, listSkills } = await import("@/main/skill-manager");
  await expect(seedBundledSkills()).resolves.toBeUndefined();
  expect((await lstat(link)).isSymbolicLink()).toBe(true);
  expect(await readlink(link)).toBe(missing);
  expect((await listSkills()).some((s) => s.dirName === "pdf")).toBe(false);
  expect((await listSkills()).some((s) => s.dirName === "docx")).toBe(true);
  expect((await (await import("@/main/session-store")).loadMessages("s1"))[0].text).toContain(oldRoot);
});

it("keeps source data intact when a newer format is encountered", async () => {
  await seed();
  await put("data-format.json", { version: 99 });
  const before = await readFile(path.join(data, "workspaces.json"), "utf8");
  await expect((await import("@/main/data-format")).ensureDataFormat()).rejects.toThrow("更新应用");
  expect(await readFile(path.join(data, "workspaces.json"), "utf8")).toBe(before);
});

it("binds a legacy independent session through the store while preserving history and guarding active runs", async () => {
  await seed();
  const store = await import("@/main/session-store");
  const next = path.join(root, "chosen-directory");
  await mkdir(next);
  await expect(store.setSessionDirectory("legacy-home", "default", next, () => true)).rejects.toThrow("会话正在运行");
  expect((await store.getSessionMeta("legacy-home"))?.workingDirectory).toBe(String.raw`C:\Users\old`);
  await store.setSessionDirectory("legacy-home", "default", next, () => false);
  expect(await store.requireSessionDirectory("legacy-home")).toBe(next);
  expect((await store.getSessionMeta("legacy-home"))?.id).toBe("legacy-home");
  await store.deleteSession("legacy-home");
  await expect(access(next)).resolves.toBeUndefined();
});

it.each([0, 1])("moves all nine existing files without changing their contents from format %s", async (version) => {
  const { DATA_FILE_LOCATIONS } = await import("@/main/data-paths");
  if (version) await put("data-format.json", { version });
  await put("backups/directory-format-v1.json", "existing-upgrade-backup");
  await put("local-proxy.json", "unmanaged-history");
  for (const name of Object.keys(DATA_FILE_LOCATIONS)) await put(name, ` {"original":"${name}"}\n`);
  const { ensureDataFormat } = await import("@/main/data-format");
  await ensureDataFormat();
  for (const [name, destination] of Object.entries(DATA_FILE_LOCATIONS)) {
    expect(await readFile(path.join(data, destination), "utf8")).toBe(` {"original":"${name}"}\n`);
    await expect(access(path.join(data, name))).rejects.toThrow();
  }
  expect(await readFile(path.join(data, "local-proxy.json"), "utf8")).toBe("unmanaged-history");
  expect(await readFile(path.join(data, "backups/directory-format-v1.json"), "utf8")).toBe("existing-upgrade-backup");
  expect(JSON.parse(await readFile(path.join(data, "data-format.json"), "utf8"))).toEqual({ version: 2 });
  const backup = await readFile(path.join(data, "backups/directory-format-v2.json"), "utf8");
  vi.resetModules();
  await (await import("@/main/data-format")).ensureDataFormat();
  expect(await readFile(path.join(data, "backups/directory-format-v2.json"), "utf8")).toBe(backup);
  await expect(access(path.join(data, "data-upgrade.json"))).rejects.toThrow();
});

it("rolls back moved configurations on failure and retries after a process restart", async () => {
  await put("data-format.json", { version: 1 });
  await put("providers.json", "providers-original");
  await put("mcp.json", "mcp-original");
  const fs = await import("@/main/utils/fs");
  const write = fs.replaceFileAtomically;
  const spy = vi.spyOn(fs, "replaceFileAtomically").mockImplementation(async (file, content) => {
    if (file === path.join(data, "config/mcp.json")) throw new Error("disk unavailable");
    return write(file, content);
  });
  await expect((await import("@/main/data-format")).ensureDataFormat()).rejects.toThrow("disk unavailable");
  expect(await readFile(path.join(data, "providers.json"), "utf8")).toBe("providers-original");
  expect(await readFile(path.join(data, "mcp.json"), "utf8")).toBe("mcp-original");
  await expect(access(path.join(data, "config/providers.json"))).rejects.toThrow();
  expect(JSON.parse(await readFile(path.join(data, "data-format.json"), "utf8")).version).toBe(1);
  spy.mockRestore(); vi.resetModules();
  await (await import("@/main/data-format")).ensureDataFormat();
  expect(await readFile(path.join(data, "config/providers.json"), "utf8")).toBe("providers-original");
  await expect(access(path.join(data, "providers.json"))).rejects.toThrow();
});

it("finishes a layout journal interrupted between copying a target and deleting a source", async () => {
  await put("data-format.json", { version: 1 });
  await put("config/providers.json", "original");
  await put("data-upgrade.json", { version: 2, changes: [
    { file: "config/providers.json", before: null, after: "original" },
    { file: "providers.json", before: "original", after: null },
  ] });
  await (await import("@/main/data-format")).ensureDataFormat();
  expect(await readFile(path.join(data, "config/providers.json"), "utf8")).toBe("original");
  expect(JSON.parse(await readFile(path.join(data, "data-format.json"), "utf8")).version).toBe(2);
  await expect(access(path.join(data, "data-upgrade.json"))).rejects.toThrow();
});

it("preserves conflicting files and permits identical copies", async () => {
  await put("data-format.json", { version: 1 });
  await put("providers.json", "old");
  await put("config/providers.json", "new");
  const { ensureDataFormat } = await import("@/main/data-format");
  await expect(ensureDataFormat()).rejects.toThrow("存在不同的配置文件");
  expect(await readFile(path.join(data, "providers.json"), "utf8")).toBe("old");
  expect(await readFile(path.join(data, "config/providers.json"), "utf8")).toBe("new");
  await put("providers.json", "new");
  await ensureDataFormat();
  await expect(access(path.join(data, "providers.json"))).rejects.toThrow();
  expect(await readFile(path.join(data, "config/providers.json"), "utf8")).toBe("new");
});

it("writes newly installed skill metadata into state on a fresh data root", async () => {
  const { updateRegistryEntry, getRegistryEntry } = await import("@/main/skill-registry");
  const entry = { source: { type: "builtin" as const }, installedAt: 1 };
  await updateRegistryEntry("docx", entry);
  expect(await getRegistryEntry("docx")).toEqual(entry);
  await expect(access(path.join(data, "state/skill-registry.json"))).resolves.toBeUndefined();
  await expect(access(path.join(data, "skill-registry.json"))).rejects.toThrow();
});


it("leaves legacy test directories untouched when the source is already format 1", async () => {
  await put("data-format.json", { version: 1 });
  await put("sessions/notes.txt", "historical-test-data");
  await (await import("@/main/data-format")).ensureDataFormat();
  expect(await readFile(path.join(data, "sessions/notes.txt"), "utf8")).toBe("historical-test-data");
  await expect(access(path.join(data, "workspaces/default/sessions"))).rejects.toThrow();
});
