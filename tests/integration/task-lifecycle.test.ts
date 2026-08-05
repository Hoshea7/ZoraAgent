import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("task persistence lifecycle", () => {
  it("survives a module reload and completes create/read/update/delete", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "zora-task-lifecycle-"));
    vi.doMock("node:os", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:os")>();
      return { ...actual, homedir: () => homeDir };
    });

    try {
      let store = await import("@/main/task-store");
      const created = await store.createTask("workspace-1", {
        title: "Persist me",
        description: "First description",
      });

      vi.resetModules();
      store = await import("@/main/task-store");
      await expect(store.getTask("workspace-1", created.id)).resolves.toEqual(created);

      const updated = await store.updateTask({
        workspaceId: "workspace-1",
        taskId: created.id,
        updates: { description: "Updated description" },
      });
      expect(updated.description).toBe("Updated description");

      await store.deleteTask("workspace-1", created.id);
      await expect(store.listTasks("workspace-1")).resolves.toEqual([]);
    } finally {
      vi.doUnmock("node:os");
      vi.resetModules();
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
