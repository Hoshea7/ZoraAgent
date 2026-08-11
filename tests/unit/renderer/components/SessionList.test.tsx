import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { SessionMeta, WorkspaceMeta } from "@/shared/zora";
import { SessionList } from "@/renderer/components/sidebar/SessionList";
import {
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  pinnedSessionIdsAtom,
  workspaceSessionsAtom,
  workspacesAtom,
} from "@/renderer/store/workspace";

const NOW = "2026-08-11T04:00:00.000Z";
const WORKSPACE: WorkspaceMeta = {
  id: "workspace-1",
  name: "测试项目",
  path: "/tmp/workspace-1",
  createdAt: NOW,
  updatedAt: NOW,
};

function session(
  overrides: Partial<SessionMeta> & Pick<SessionMeta, "id" | "title">
): SessionMeta {
  return {
    createdAt: NOW,
    updatedAt: NOW,
    permissionMode: "ask",
    ...overrides,
  };
}

describe("SessionList", () => {
  it("shows a pinned parent session's child tasks after expansion", () => {
    const parent = session({ id: "parent-1", title: "置顶父会话" });
    const child = session({
      id: "child-1",
      title: "可见子任务",
      parentSessionId: parent.id,
      rootSessionId: parent.id,
      delegationDepth: 1,
      delegationRole: "explore",
      delegationStatus: "completed",
    });
    const store = createStore();
    store.set(workspacesAtom, [WORKSPACE]);
    store.set(workspaceSessionsAtom, { [WORKSPACE.id]: [parent, child] });
    store.set(currentWorkspaceIdAtom, WORKSPACE.id);
    store.set(currentSessionIdAtom, null);
    store.set(pinnedSessionIdsAtom, new Set([parent.id]));

    render(
      <Provider store={store}>
        <SessionList />
      </Provider>
    );

    const pinnedSection = screen.getByText("置顶").closest("section");
    expect(pinnedSection).not.toBeNull();
    const pinned = within(pinnedSection!);
    expect(pinned.getByText(parent.title)).toBeInTheDocument();

    const expandButton = pinned.queryByRole("button", { name: "展开子任务" });
    if (expandButton) {
      fireEvent.click(expandButton);
    }

    expect(pinned.getByText(child.title)).toBeInTheDocument();
    expect(screen.getAllByText(child.title)).toHaveLength(1);
  });
});
