import { directoryToolError, wrapPiDirectoryGuard, createClaudeDirectoryGuardHook } from "@/main/runtime/directory-guard";
import { isDirectoryAvailable } from "@/main/project-directory";
vi.mock("@/main/project-directory", () => ({ isDirectoryAvailable: vi.fn(async () => false) }));
const context = { workingDirectory: "/data/runtime", boundWorkingDirectory: "/old/project" };
beforeEach(() => vi.mocked(isDirectoryAvailable).mockResolvedValue(false));

it.each(["Read", "Write", "Edit", "Glob", "Grep", "LS", "Bash"])("blocks %s in an unavailable project independently of approval mode", async (tool) => {
  expect(await directoryToolError(tool, { path: "note.txt" }, context)).toContain("该项目文件夹已被删除或移动");
});
it("keeps saved attachments, explicit independent files, and non-file tools available", async () => {
  expect(await directoryToolError("Read", { file_path: "/data/attachments/note.txt" }, context)).toBeUndefined();
  expect(await directoryToolError("mcp__zora_document__read_document", { attachmentId: "attachment" }, context)).toBeUndefined();
  expect(await directoryToolError("WebSearch", { query: "project" }, context)).toBeUndefined();
  expect(await directoryToolError("Read", { path: "/old/project/note.txt" }, context)).toBeDefined();
  expect(await directoryToolError("Write", { path: "/data/runtime/note.txt" }, context)).toBeDefined();
});
it("detects a directory disappearing during a running turn, and resumes normal tools after rebinding", async () => {
  const original = { workingDirectory: "/old/project", boundWorkingDirectory: "/old/project" };
  expect(await directoryToolError("Bash", {}, original)).toBeDefined();
  vi.mocked(isDirectoryAvailable).mockResolvedValue(true);
  expect(await directoryToolError("Bash", {}, original)).toBeUndefined();
  expect(await directoryToolError("Read", { path: "file" }, context)).toBeDefined();
});
it("blocks unbound relative paths and Windows source paths without confusing neighboring folders", async () => {
  expect(await directoryToolError("Read", { path: "file" }, { ...context, boundWorkingDirectory: "" })).toBeDefined();
  expect(await directoryToolError("Read", { path: String.raw`C:\old\project\file` }, { ...context, boundWorkingDirectory: String.raw`C:\old\project` })).toBeDefined();
  expect(await directoryToolError("Read", { path: "/old/project-other/file" }, context)).toBeUndefined();
});
it("applies both runtime guards before executing a file operation", async () => {
  const execute = vi.fn();
  const tool = wrapPiDirectoryGuard({ name: "read", execute } as never, context);
  await expect(tool.execute("call", { path: "file" })).rejects.toThrow("该项目文件夹已被删除或移动");
  expect(execute).not.toHaveBeenCalled();
  const hook = createClaudeDirectoryGuardHook(context);
  const result = await hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "file" } } as never, undefined, { signal: new AbortController().signal });
  expect(result).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
});
