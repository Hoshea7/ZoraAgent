import { render, screen, within } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { SessionMeta, WorkspaceMeta } from "@/shared/zora";
import { ChatHeader } from "@/renderer/components/chat/ChatHeader";
import {
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  workspaceSessionsAtom,
  workspacesAtom,
} from "@/renderer/store/workspace";

const NOW = "2026-08-14T08:00:00.000Z";
const PROJECT: WorkspaceMeta = {
  id: "project-1",
  name: "zora-agent",
  path: "/tmp/zora-agent",
  createdAt: NOW,
  updatedAt: NOW,
};
const DEFAULT_WORKSPACE: WorkspaceMeta = {
  id: "default",
  name: "默认工作区",
  path: "/tmp/default",
  createdAt: NOW,
  updatedAt: NOW,
};
const SESSION: SessionMeta = {
  id: "session-1",
  title: "看看今天发生了什么大事",
  createdAt: NOW,
  updatedAt: NOW,
  permissionMode: "ask",
};

function renderHeader({
  workspace,
  currentSessionId,
}: {
  workspace: WorkspaceMeta;
  currentSessionId: string | null;
}) {
  const store = createStore();
  store.set(workspacesAtom, [workspace]);
  store.set(currentWorkspaceIdAtom, workspace.id);
  store.set(workspaceSessionsAtom, {
    [workspace.id]: currentSessionId ? [SESSION] : [],
  });
  store.set(currentSessionIdAtom, currentSessionId);

  render(
    <Provider store={store}>
      <ChatHeader />
    </Provider>,
  );
}

describe("ChatHeader project context", () => {
  it("shows the owning project beside an existing session title", () => {
    renderHeader({ workspace: PROJECT, currentSessionId: SESSION.id });

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading")).toHaveTextContent(SESSION.title);
    expect(within(header).getByText("/")).toBeInTheDocument();
    expect(within(header).getByText(PROJECT.name)).toBeInTheDocument();
  });

  it("shows the selected project for a new session", () => {
    renderHeader({ workspace: PROJECT, currentSessionId: null });

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading")).toHaveTextContent("新会话");
    expect(within(header).getByText(PROJECT.name)).toBeInTheDocument();
  });

  it("omits a project suffix for sessions outside a project", () => {
    renderHeader({ workspace: DEFAULT_WORKSPACE, currentSessionId: SESSION.id });

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading")).toHaveTextContent(SESSION.title);
    expect(within(header).queryByText("/")).not.toBeInTheDocument();
    expect(within(header).queryByText(DEFAULT_WORKSPACE.name)).not.toBeInTheDocument();
  });
});
