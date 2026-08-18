import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { SessionMeta, WorkspaceMeta } from "@/shared/zora";
import { SessionList } from "@/renderer/components/sidebar/SessionList";
import { runningSessionsAtom } from "@/renderer/store/chat";
import { pendingAskUserQuestionsBySessionAtom } from "@/renderer/store/hitl";
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
  it("uses the status dot without rendering child-session status labels", () => {
    const parent = session({ id: "parent-status", title: "父会话" });
    const child = session({
      id: "child-status",
      title: "继续聊天的子会话",
      parentSessionId: parent.id,
      rootSessionId: parent.id,
      delegationDepth: 1,
      delegationRole: "explore",
      delegationStatus: "completed",
    });
    const cancelledChild = session({
      id: "child-cancelled",
      title: "已取消的子会话",
      parentSessionId: parent.id,
      rootSessionId: parent.id,
      delegationDepth: 1,
      delegationRole: "explore",
      delegationStatus: "cancelled",
    });
    const store = createStore();
    store.set(workspacesAtom, [WORKSPACE]);
    store.set(workspaceSessionsAtom, {
      [WORKSPACE.id]: [parent, child, cancelledChild],
    });
    store.set(currentWorkspaceIdAtom, WORKSPACE.id);
    store.set(currentSessionIdAtom, child.id);
    store.set(runningSessionsAtom, new Set([child.id]));
    store.set(pendingAskUserQuestionsBySessionAtom, {
      [cancelledChild.id]: [
        {
          sessionId: cancelledChild.id,
          requestId: "ask-status",
          questions: [{ question: "继续吗" }],
          toolInput: {},
        },
      ],
    });

    render(
      <Provider store={store}>
        <SessionList />
      </Provider>
    );

    expect(screen.queryByTestId("session-activity-status")).toBeNull();
    expect(screen.queryByTestId("subtask-status")).toBeNull();
    const childRow = document.querySelector(`[data-session-id="${child.id}"]`);
    expect(childRow).not.toBeNull();
    expect(within(childRow as HTMLElement).queryByText("运行中")).toBeNull();
    const waitingChildRow = document.querySelector(
      `[data-session-id="${cancelledChild.id}"]`
    );
    expect(waitingChildRow).not.toBeNull();
    expect(
      within(waitingChildRow as HTMLElement).queryByText("待确认")
    ).toBeNull();
    expect(screen.getByTestId("subtask-progress")).toHaveTextContent("1/2");
  });
  it("shows recent project conversations when the newest records are child sessions", () => {
    const recentParent = session({
      id: "recent-parent",
      title: "最近父会话",
      updatedAt: "2026-08-11T04:00:00.000Z",
    });
    const recentChildren = Array.from({ length: 4 }, (_, index) =>
      session({
        id: `recent-child-${index}`,
        title: `最近子任务 ${index}`,
        parentSessionId: recentParent.id,
        rootSessionId: recentParent.id,
        delegationDepth: 1,
        delegationRole: "explore",
        delegationStatus: "completed",
        updatedAt: `2026-08-11T04:0${index + 1}:00.000Z`,
      })
    );
    const olderParents = Array.from({ length: 4 }, (_, index) =>
      session({
        id: `older-parent-${index}`,
        title: `较早父会话 ${index}`,
        updatedAt: `2026-08-11T03:0${index}:00.000Z`,
      })
    );
    const store = createStore();
    store.set(workspacesAtom, [WORKSPACE]);
    store.set(workspaceSessionsAtom, {
      [WORKSPACE.id]: [...recentChildren].reverse().concat(recentParent, olderParents),
    });
    store.set(currentWorkspaceIdAtom, WORKSPACE.id);
    store.set(currentSessionIdAtom, null);
    store.set(pinnedSessionIdsAtom, new Set());

    render(
      <Provider store={store}>
        <SessionList />
      </Provider>
    );

    expect(screen.getByText(recentParent.title)).toBeInTheDocument();
    expect(screen.queryByText("暂无会话")).not.toBeInTheDocument();
  });

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
    const unpinnedParent = session({
      id: "parent-2",
      title: "未置顶父会话",
    });
    const unpinnedChild = session({
      id: "child-2",
      title: "未置顶子任务",
      parentSessionId: unpinnedParent.id,
      rootSessionId: unpinnedParent.id,
      delegationDepth: 1,
      delegationRole: "explore",
      delegationStatus: "completed",
    });
    const store = createStore();
    store.set(workspacesAtom, [WORKSPACE]);
    store.set(workspaceSessionsAtom, {
      [WORKSPACE.id]: [parent, child, unpinnedParent, unpinnedChild],
    });
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
    expect(pinned.queryByText(unpinnedParent.title)).not.toBeInTheDocument();
    expect(pinned.queryByText(unpinnedChild.title)).not.toBeInTheDocument();
    expect(screen.getAllByText(child.title)).toHaveLength(1);
  });
});
