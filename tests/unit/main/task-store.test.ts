import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tempHomes = new Set<string>();

function createTempHome() {
  const homeDir = mkdtempSync(path.join(tmpdir(), "zora-task-"));
  tempHomes.add(homeDir);
  return homeDir;
}

function getTasksFile(homeDir: string, workspaceId = "default") {
  return path.join(homeDir, ".zora", "workspaces", workspaceId, "tasks", "tasks.json");
}

async function loadTaskStore(homeDir: string) {
  vi.resetModules();
  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => homeDir };
  });
  return import("@/main/task-store");
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("node:os");
  vi.resetModules();
  for (const homeDir of tempHomes) {
    rmSync(homeDir, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("main task-store", () => {
  it("creates a manual todo task with the step-one defaults and persists it", async () => {
    const homeDir = createTempHome();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T08:00:00.000Z"));
    const { createTask, getTask, listTasks } = await loadTaskStore(homeDir);

    const created = await createTask("workspace-1", {
      title: "  完成任务面板  ",
      description: "  可人工验收  ",
    });

    expect(created).toEqual(
      expect.objectContaining({
        workspaceId: "workspace-1",
        title: "完成任务面板",
        description: "可人工验收",
        status: "todo",
        assignee: "zora",
        trigger: "manual",
        linkedSessionIds: [],
        comments: [],
        metadata: {},
      })
    );
    await expect(getTask("workspace-1", created.id)).resolves.toEqual(created);
    await expect(listTasks("workspace-1")).resolves.toEqual([created]);
    expect(JSON.parse(readFileSync(getTasksFile(homeDir, "workspace-1"), "utf8"))).toEqual([
      created,
    ]);
  });

  it("updates editable fields and deletes without changing another workspace", async () => {
    const homeDir = createTempHome();
    const { createTask, deleteTask, listTasks, updateTask } = await loadTaskStore(homeDir);
    const first = await createTask("workspace-1", { title: "First" });
    const second = await createTask("workspace-2", { title: "Second" });

    const updated = await updateTask({
      workspaceId: "workspace-1",
      taskId: first.id,
      updates: { title: "Updated", description: "Details" },
    });
    expect(updated).toEqual(
      expect.objectContaining({ title: "Updated", description: "Details", status: "todo" })
    );

    await deleteTask("workspace-1", first.id);
    await expect(listTasks("workspace-1")).resolves.toEqual([]);
    await expect(listTasks("workspace-2")).resolves.toEqual([second]);
  });

  it("serializes concurrent creates so no task is lost", async () => {
    const homeDir = createTempHome();
    const { createTask, listTasks } = await loadTaskStore(homeDir);
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createTask("default", { title: `Task ${index + 1}` })
      )
    );
    const tasks = await listTasks("default");
    expect(tasks).toHaveLength(8);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(8);
  });

  it("does not overwrite a malformed task file", async () => {
    const homeDir = createTempHome();
    const tasksFile = getTasksFile(homeDir);
    mkdirSync(path.dirname(tasksFile), { recursive: true });
    writeFileSync(tasksFile, "{not json", "utf8");
    const { createTask, listTasks } = await loadTaskStore(homeDir);

    await expect(listTasks("default")).rejects.toThrow("读取任务失败");
    await expect(createTask("default", { title: "New" })).rejects.toThrow("读取任务失败");
    expect(readFileSync(tasksFile, "utf8")).toBe("{not json");
  });
});
