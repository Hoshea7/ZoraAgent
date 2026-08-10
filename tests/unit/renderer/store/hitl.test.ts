import { createStore } from "jotai";
import {
  permissionModeAtom,
  setPermissionModeAtom,
} from "@/renderer/store/hitl";
import {
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  workspaceSessionsAtom,
} from "@/renderer/store/workspace";

function session(id: string, permissionMode: "ask" | "smart" | "yolo") {
  return {
    id,
    title: id,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    permissionMode,
  };
}

describe("session permission mode store", () => {
  it("reads and updates the active session without changing sibling sessions", async () => {
    const store = createStore();
    store.set(currentWorkspaceIdAtom, "default");
    store.set(workspaceSessionsAtom, {
      default: [session("parent", "ask"), session("child", "smart")],
    });
    store.set(currentSessionIdAtom, "child");

    expect(store.get(permissionModeAtom)).toBe("smart");

    await store.set(setPermissionModeAtom, "yolo");

    expect(window.zora.setPermissionMode).toHaveBeenCalledWith(
      "child",
      "yolo",
      "default"
    );
    expect(store.get(permissionModeAtom)).toBe("yolo");
    expect(store.get(workspaceSessionsAtom).default).toEqual([
      expect.objectContaining({ id: "parent", permissionMode: "ask" }),
      expect.objectContaining({ id: "child", permissionMode: "yolo" }),
    ]);
  });

  it("restores the persisted mode when the main process rejects an update", async () => {
    const store = createStore();
    store.set(currentWorkspaceIdAtom, "default");
    store.set(workspaceSessionsAtom, {
      default: [session("child", "smart")],
    });
    store.set(currentSessionIdAtom, "child");
    vi.mocked(window.zora.setPermissionMode).mockRejectedValueOnce(
      new Error("permission mode update failed")
    );

    await expect(store.set(setPermissionModeAtom, "yolo")).rejects.toThrow(
      "permission mode update failed"
    );

    expect(store.get(permissionModeAtom)).toBe("smart");
  });
});
