import { createStore } from "jotai";
import type { SessionMeta, WorkspaceMeta } from "@/shared/zora";
import {
  pinnedSessionIdsAtom,
  pinnedWorkspaceIdsAtom,
  reorderSessionsAtom,
  reorderWorkspacesAtom,
  workspaceSessionsAtom,
  workspacesAtom,
} from "@/renderer/store/workspace";

const NOW = "2026-08-11T04:00:00.000Z";

function workspace(id: string): WorkspaceMeta {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function session(
  id: string,
  parentSessionId?: string
): SessionMeta {
  return {
    id,
    title: id,
    createdAt: NOW,
    updatedAt: NOW,
    permissionMode: "ask",
    parentSessionId,
  };
}

describe("sidebar manual order", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reorders projects and persists the exact order", () => {
    const store = createStore();
    store.set(workspacesAtom, [workspace("default"), workspace("alpha"), workspace("beta")]);
    store.set(pinnedWorkspaceIdsAtom, new Set());

    store.set(reorderWorkspacesAtom, {
      draggedWorkspaceId: "beta",
      targetWorkspaceId: "alpha",
      placement: "before",
    });

    expect(store.get(workspacesAtom).map((item) => item.id)).toEqual([
      "default",
      "beta",
      "alpha",
    ]);
    expect(JSON.parse(window.localStorage.getItem("zora:workspaceOrder") ?? "[]")).toEqual([
      "beta",
      "alpha",
    ]);
  });

  it("reorders sessions only inside the same hierarchy", () => {
    const store = createStore();
    const parentA = session("parent-a");
    const parentB = session("parent-b");
    const childA = session("child-a", parentA.id);
    const childB = session("child-b", parentA.id);
    store.set(workspaceSessionsAtom, {
      project: [parentA, childA, childB, parentB],
    });
    store.set(pinnedSessionIdsAtom, new Set());

    store.set(reorderSessionsAtom, {
      workspaceId: "project",
      draggedSessionId: childB.id,
      targetSessionId: childA.id,
      placement: "before",
    });

    expect(store.get(workspaceSessionsAtom).project.map((item) => item.id)).toEqual([
      parentA.id,
      childB.id,
      childA.id,
      parentB.id,
    ]);

    store.set(reorderSessionsAtom, {
      workspaceId: "project",
      draggedSessionId: childA.id,
      targetSessionId: parentB.id,
      placement: "before",
    });

    expect(store.get(workspaceSessionsAtom).project.map((item) => item.id)).toEqual([
      parentA.id,
      childB.id,
      childA.id,
      parentB.id,
    ]);
  });
});
