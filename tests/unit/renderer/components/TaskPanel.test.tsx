import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { vi } from "vitest";
import { TaskPanel } from "@/renderer/components/task/TaskPanel";
import { currentWorkspaceIdAtom } from "@/renderer/store/workspace";
import type { Task } from "@/shared/types/task";

const NOW = "2026-08-05T08:00:00.000Z";

function createTask(id: string, title: string, description = ""): Task {
  return {
    id,
    workspaceId: "workspace-1",
    title,
    description,
    status: "todo",
    assignee: "zora",
    trigger: "manual",
    linkedSessionIds: [],
    comments: [],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function renderPanel() {
  const store = createStore();
  store.set(currentWorkspaceIdAtom, "workspace-1");
  render(
    <Provider store={store}>
      <TaskPanel />
    </Provider>
  );
}

describe("TaskPanel", () => {
  it("creates, selects, displays and deletes a task in the current workspace", async () => {
    let tasks: Task[] = [];
    vi.mocked(window.zora.listTasks).mockImplementation(async () => tasks);
    vi.mocked(window.zora.createTask).mockImplementation(async (_workspaceId, input) => {
      const task = createTask("task-1", input.title.trim(), input.description?.trim());
      tasks = [task];
      return task;
    });
    vi.mocked(window.zora.deleteTask).mockImplementation(async () => {
      tasks = [];
    });

    renderPanel();
    expect(await screen.findByText("还没有任务")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ 新建任务" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "首个任务" } });
    fireEvent.change(screen.getByLabelText("描述（选填）"), {
      target: { value: "人工能看到详情" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByRole("heading", { name: "首个任务" })).toBeInTheDocument();
    expect(screen.getByText("人工能看到详情")).toBeInTheDocument();
    expect(window.zora.createTask).toHaveBeenCalledWith("workspace-1", {
      title: "首个任务",
      description: "人工能看到详情",
    });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => {
      expect(screen.getByText("还没有任务")).toBeInTheDocument();
    });
    expect(window.zora.deleteTask).toHaveBeenCalledWith("workspace-1", "task-1");
  });
});
