import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("groups all workspaces by priority and recent activity", () => {
    const now = new Date();
    const secondWorkspace: WorkspaceMeta = {
      ...WORKSPACE,
      id: "workspace-2",
      name: "第二项目",
      path: "/tmp/workspace-2",
    };
    const waiting = session({
      id: "waiting-session",
      title: "等待确认的会话",
      updatedAt: new Date(now.getTime() - 60_000).toISOString(),
    });
    const running = session({
      id: "running-session",
      title: "正在运行的会话",
      updatedAt: now.toISOString(),
    });
    const recent = session({
      id: "recent-session",
      title: "今日普通会话",
      updatedAt: new Date(now.getTime() - 120_000).toISOString(),
    });
    const store = createStore();
    store.set(workspacesAtom, [WORKSPACE, secondWorkspace]);
    store.set(workspaceSessionsAtom, {
      [WORKSPACE.id]: [running, recent],
      [secondWorkspace.id]: [waiting],
    });
    store.set(currentWorkspaceIdAtom, WORKSPACE.id);
    store.set(currentSessionIdAtom, null);
    store.set(runningSessionsAtom, new Set([running.id]));
    store.set(pendingAskUserQuestionsBySessionAtom, {
      [waiting.id]: [
        {
          sessionId: waiting.id,
          requestId: "activity-waiting",
          questions: [{ question: "继续吗" }],
          toolInput: {},
        },
      ],
    });

    render(
      <Provider store={store}>
        <SessionList viewMode="activity" />
      </Provider>,
    );

    expect(screen.getByTestId("activity-view")).toBeVisible();
    expect(screen.queryByText("项目")).toBeNull();
    const priorityHeading = screen.getByRole("heading", { name: "优先级" });
    const todayHeading = screen.getByRole("heading", { name: "今天" });
    expect(priorityHeading).toBeVisible();
    expect(priorityHeading).toHaveClass(
      "font-sans",
      "text-[13px]",
      "font-medium",
      "leading-[18px]",
    );
    expect(priorityHeading.tagName).toBe("SPAN");
    expect(todayHeading).toHaveClass(
      "font-sans",
      "text-[13px]",
      "font-medium",
      "leading-[18px]",
    );

    const activityRows = document.querySelectorAll(
      '[data-session-view="activity"]',
    );
    expect(
      [...activityRows].map((row) => row.getAttribute("data-session-id")),
    ).toEqual([waiting.id, running.id, recent.id]);
    expect(screen.getByText("第二项目 · 工作")).toBeVisible();
    expect(screen.getAllByText("测试项目 · 工作")).toHaveLength(2);
  });

  it("keeps freshness order when the selected activity session is older", () => {
    const now = new Date();
    const older = session({
      id: "selected-older-session",
      title: "已选中的较早会话",
      updatedAt: new Date(now.getTime() - 120_000).toISOString(),
    });
    const newer = session({
      id: "newer-session",
      title: "更新的会话",
      updatedAt: new Date(now.getTime() - 60_000).toISOString(),
    });
    const store = createStore();
    store.set(workspacesAtom, [WORKSPACE]);
    store.set(workspaceSessionsAtom, {
      [WORKSPACE.id]: [older, newer],
    });
    store.set(currentWorkspaceIdAtom, WORKSPACE.id);
    store.set(currentSessionIdAtom, older.id);

    render(
      <Provider store={store}>
        <SessionList viewMode="activity" />
      </Provider>,
    );

    const activityRows = document.querySelectorAll(
      '[data-session-view="activity"]',
    );
    expect(
      [...activityRows].map((row) => row.getAttribute("data-session-id")),
    ).toEqual([newer.id, older.id]);

    const selectedRow = document.querySelector(
      `[data-session-id="${older.id}"]`,
    );
    expect(selectedRow).toHaveAttribute("aria-current", "page");
    expect(selectedRow).toHaveClass("bg-white/75", "shadow-sm");
  });

  it("defers completed priority sessions until activity view reopens", async () => {
    const now = new Date();
    const running = session({
      id: "sticky-running-session",
      title: "本轮完成后保持位置",
      updatedAt: now.toISOString(),
    });
    const store = createStore();
    store.set(workspacesAtom, [WORKSPACE]);
    store.set(workspaceSessionsAtom, { [WORKSPACE.id]: [running] });
    store.set(currentWorkspaceIdAtom, WORKSPACE.id);
    store.set(currentSessionIdAtom, null);
    store.set(runningSessionsAtom, new Set([running.id]));

    const view = render(
      <Provider store={store}>
        <SessionList viewMode="activity" />
      </Provider>,
    );
    const prioritySection = screen
      .getByRole("heading", { name: "优先级" })
      .closest("section") as HTMLElement;
    expect(within(prioritySection).getByText(running.title)).toBeVisible();

    act(() => store.set(runningSessionsAtom, new Set()));
    await waitFor(() => {
      expect(within(prioritySection).getByText(running.title)).toBeVisible();
    });
    expect(screen.queryByText("整理", { exact: true })).toBeNull();

    view.rerender(
      <Provider store={store}>
        <SessionList viewMode="projects" />
      </Provider>,
    );
    view.rerender(
      <Provider store={store}>
        <SessionList viewMode="activity" />
      </Provider>,
    );

    await waitFor(() => {
      const reopenedTodaySection = screen
        .getByRole("heading", { name: "今天" })
        .closest("section") as HTMLElement;
      expect(within(reopenedTodaySection).getByText(running.title)).toBeVisible();
    });
    expect(
      screen.queryByRole("button", { name: "按最新状态整理会话" }),
    ).toBeNull();
  });

  it("places a newly created session directly in priority", async () => {
    const store = createStore();
    store.set(workspacesAtom, [WORKSPACE]);
    store.set(workspaceSessionsAtom, { [WORKSPACE.id]: [] });
    store.set(currentWorkspaceIdAtom, WORKSPACE.id);
    store.set(currentSessionIdAtom, null);

    render(
      <Provider store={store}>
        <SessionList viewMode="activity" />
      </Provider>,
    );

    const created = session({
      id: "new-current-session",
      title: "新建后直接进入优先级",
      updatedAt: new Date().toISOString(),
    });
    act(() => {
      store.set(workspaceSessionsAtom, { [WORKSPACE.id]: [created] });
      store.set(currentSessionIdAtom, created.id);
    });

    const prioritySection = screen
      .getByRole("heading", { name: "优先级" })
      .closest("section") as HTMLElement;
    await waitFor(() => {
      expect(within(prioritySection).getByText(created.title)).toBeVisible();
    });
    expect(screen.queryByRole("heading", { name: "今天" })).toBeNull();

    act(() => store.set(runningSessionsAtom, new Set([created.id])));
    expect(within(prioritySection).getByText(created.title)).toBeVisible();
  });

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
    store.set(runningSessionsAtom, new Set([parent.id, child.id]));
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

    expect(screen.getByRole("button", { name: "项目" })).toHaveClass(
      "text-[13px]",
      "font-medium",
      "leading-[18px]",
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
    const parentRow = document.querySelector(`[data-session-id="${parent.id}"]`);
    expect(parentRow).not.toBeNull();
    expect(within(parentRow as HTMLElement).getByText("运行中")).toBeVisible();
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
