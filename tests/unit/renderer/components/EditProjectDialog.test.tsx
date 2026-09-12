import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { EditProjectDialog } from "@/renderer/components/sidebar/EditProjectDialog";
import { workspacesAtom } from "@/renderer/store/workspace";

const workspace = { id: "project", name: "原项目", path: "/old/project", createdAt: "2026-09-12", updatedAt: "2026-09-12" };
function setup() {
  const close = vi.fn();
  const store = createStore();
  store.set(workspacesAtom, [workspace]);
  render(<Provider store={store}><EditProjectDialog workspace={workspace} onClose={close} /></Provider>);
  return { close, store };
}
it("stages name and directory until Save and cancels without updating", async () => {
  const { close } = setup();
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "新名称" } });
  vi.mocked(window.zora.pickWorkspaceDirectory).mockResolvedValue("/new/project");
  fireEvent.click(screen.getByRole("button", { name: "选择文件夹" }));
  await waitFor(() => expect(screen.getByLabelText("本地文件夹")).toHaveValue("/new/project"));
  expect(window.zora.updateWorkspace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(close).toHaveBeenCalledOnce();
  expect(window.zora.updateWorkspace).not.toHaveBeenCalled();
});
it("keeps staged edits and shows a save failure without changing the project", async () => {
  const { close, store } = setup();
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "新名称" } });
  vi.mocked(window.zora.updateWorkspace).mockRejectedValue(new Error("该项目文件夹已被删除或移动"));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("该项目文件夹已被删除或移动");
  expect(screen.getByLabelText("项目名称")).toHaveValue("新名称");
  expect(store.get(workspacesAtom)).toEqual([workspace]);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
});
