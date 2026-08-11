import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { SessionMeta, WorkspaceMeta } from "@/shared/zora";
import { SessionList } from "@/renderer/components/sidebar/SessionList";
import {
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  pinnedSessionIdsAtom,
  pinnedWorkspaceIdsAtom,
  workspaceSessionsAtom,
  workspacesAtom,
} from "@/renderer/store/workspace";

const NOW = "2026-08-11T04:00:00.000Z";
const PROJECT: WorkspaceMeta = {
  id: "project-zora",
  name: "zora-agent",
  path: "/tmp/zora-agent",
  createdAt: NOW,
  updatedAt: NOW,
};
const OTHER_PROJECT: WorkspaceMeta = {
  id: "project-skill-helper",
  name: "skill helper",
  path: "/tmp/skill-helper",
  createdAt: NOW,
  updatedAt: NOW,
};
const SESSION: SessionMeta = {
  id: "session-zora",
  title: "Zora 会话",
  createdAt: NOW,
  updatedAt: NOW,
  permissionMode: "ask",
};

describe("SessionList project drag preview", () => {
  function renderList() {
    const store = createStore();
    store.set(workspacesAtom, [PROJECT, OTHER_PROJECT]);
    store.set(workspaceSessionsAtom, {
      [PROJECT.id]: [SESSION],
      [OTHER_PROJECT.id]: [],
    });
    store.set(currentWorkspaceIdAtom, PROJECT.id);
    store.set(currentSessionIdAtom, null);
    store.set(pinnedWorkspaceIdsAtom, new Set());
    store.set(pinnedSessionIdsAtom, new Set());

    render(
      <Provider store={store}>
        <SessionList />
      </Provider>
    );
  }

  it("uses only the project header as the native drag image source", () => {
    renderList();

    const projectButton = screen.getByRole("button", {
      name: PROJECT.name,
      exact: true,
    });
    fireEvent.click(projectButton);
    expect(screen.getByText(SESSION.title)).toBeInTheDocument();

    const dragSource = projectButton.closest('[draggable="true"]');
    expect(dragSource).not.toBeNull();
    expect(within(dragSource as HTMLElement).queryByText(SESSION.title)).toBeNull();
    expect(within(dragSource as HTMLElement).queryByText(OTHER_PROJECT.name)).toBeNull();
  });

  it("cancels the delayed path preview while a project is being dragged", () => {
    vi.useFakeTimers();
    renderList();

    const projectLabel = screen.getByText(PROJECT.name, { exact: true });
    const dragSource = projectLabel.closest('[draggable="true"]');
    expect(dragSource).not.toBeNull();

    fireEvent.mouseEnter(projectLabel);
    fireEvent.dragStart(dragSource as HTMLElement, {
      dataTransfer: {
        effectAllowed: "move",
        setData: vi.fn(),
      },
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(screen.queryByText(PROJECT.path, { exact: true })).toBeNull();
    fireEvent.dragEnd(dragSource as HTMLElement);
    vi.useRealTimers();
  });
});
