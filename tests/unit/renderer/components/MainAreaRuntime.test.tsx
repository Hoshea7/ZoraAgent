import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MainArea } from "@/renderer/components/layout/MainArea";
import { sessionMessagesAtom } from "@/renderer/store/chat";
import { providersAtom, providersLoadedAtom } from "@/renderer/store/provider";
import {
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  workspaceSessionsAtom,
  workspacesAtom,
} from "@/renderer/store/workspace";
import type { ProviderConfig } from "@/shared/types/provider";
import type { ConversationMessage, SessionMeta, WorkspaceMeta } from "@/shared/zora";

const provider: ProviderConfig = {
  id: "provider-1",
  name: "OpenAI",
  providerType: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  modelId: "gpt-5-mini",
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

function renderMainArea() {
  const store = createStore();
  store.set(providersAtom, [provider]);
  store.set(providersLoadedAtom, true);
  render(
    <Provider store={store}>
      <MainArea />
    </Provider>
  );
  return store;
}

describe("MainArea runtime selection", () => {
  it("saves the default Pi runtime before sending the first query", async () => {
    vi.mocked(window.zora.createSession).mockResolvedValue({
      id: "session-1",
      title: "Hello",
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });
    window.zora.setSessionRuntime = vi.fn().mockResolvedValue(undefined);
    renderMainArea();

    fireEvent.change(screen.getByPlaceholderText(/给 Zora 发消息/), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => {
      expect(window.zora.setSessionRuntime).toHaveBeenCalledWith(
        "session-1",
        "pi",
        "default"
      );
    });
  });

  it("saves Claude when the user changes the new-conversation runtime", async () => {
    vi.mocked(window.zora.createSession).mockResolvedValue({
      id: "session-2",
      title: "Hello",
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });
    window.zora.setSessionRuntime = vi.fn().mockResolvedValue(undefined);
    renderMainArea();

    fireEvent.pointerDown(screen.getByRole("button", {
      name: "切换运行时",
    }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByText("Claude"));
    fireEvent.change(screen.getByPlaceholderText(/给 Zora 发消息/), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => {
      expect(window.zora.setSessionRuntime).toHaveBeenCalledWith(
        "session-2",
        "claude",
        "default"
      );
    });
  });

  it("restores the visible history when revising a message fails", async () => {
    const workspace: WorkspaceMeta = {
      id: "default",
      name: "默认工作区",
      path: "/tmp/default",
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    const session: SessionMeta = {
      id: "session-1",
      title: "原始问题",
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      permissionMode: "ask",
    };
    const messages: ConversationMessage[] = [
      { id: "user-1", role: "user", text: "原始问题", timestamp: 1 },
      {
        id: "assistant-1",
        role: "assistant",
        timestamp: 2,
        turn: {
          id: "assistant-1",
          status: "done",
          startedAt: 2,
          completedAt: 2,
          processSteps: [],
          bodySegments: [{ id: "body-1", text: "原始回复" }],
        },
      },
      { id: "user-2", role: "user", text: "后续问题", timestamp: 3 },
    ];
    const store = renderMainArea();
    act(() => {
      store.set(workspacesAtom, [workspace]);
      store.set(currentWorkspaceIdAtom, workspace.id);
      store.set(workspaceSessionsAtom, { [workspace.id]: [session] });
      store.set(currentSessionIdAtom, session.id);
      store.set(sessionMessagesAtom, { [session.id]: messages });
    });
    vi.mocked(window.zora.submitUserEdit).mockRejectedValue(
      new Error("修改失败")
    );

    const conversationLog = await screen.findByRole("log");
    const originalMessage = within(conversationLog).getByText("原始问题");
    const article = originalMessage.closest("article");
    expect(article).not.toBeNull();
    fireEvent.click(
      within(article as HTMLElement).getByRole("button", { name: "修改消息" })
    );
    fireEvent.change(screen.getByRole("textbox", { name: "编辑消息" }), {
      target: { value: "修改后的问题" },
    });
    fireEvent.click(
      within(article as HTMLElement).getByRole("button", {
        name: "发送",
        exact: true,
      })
    );

    expect(await screen.findByText("修改失败")).toBeVisible();
    expect(store.get(sessionMessagesAtom)[session.id]).toEqual(messages);
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
    expect(within(conversationLog).getByText("原始问题")).toBeVisible();
    expect(within(conversationLog).getByText("原始回复")).toBeVisible();
    expect(within(conversationLog).getByText("后续问题")).toBeVisible();
    expect(within(conversationLog).queryByText("修改后的问题")).toBeNull();
    expect(window.zora.loadMessages).not.toHaveBeenCalled();
  });
});
