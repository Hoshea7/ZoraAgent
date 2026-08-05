import { FormEvent, useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  createTaskAtom,
  deleteTaskAtom,
  loadTasksAtom,
  selectedTaskAtom,
  selectedTaskIdAtom,
  tasksAtom,
  tasksErrorAtom,
  tasksLoadingAtom,
} from "../../store/task";
import { currentWorkspaceIdAtom } from "../../store/workspace";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";

function TaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5h6m-7 4h8m-8 4h5m-7 7h12a2 2 0 002-2V6a2 2 0 00-2-2h-1.5a2.5 2.5 0 00-5 0H6a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

function CreateTaskDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const createTask = useSetAtom(createTaskAtom);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createTask({
        workspaceId,
        task: { title, description },
      });
      onClose();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/25 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-title"
        className="w-full max-w-[440px] rounded-[18px] bg-[#fffdfb] p-5 shadow-[0_24px_70px_rgba(41,37,36,0.22)] ring-1 ring-stone-900/10"
      >
        <h2 id="create-task-title" className="text-[17px] font-semibold text-stone-950">
          新建任务
        </h2>
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-1.5 text-[12px] font-medium text-stone-700">
            <span>标题</span>
            <input
              autoFocus
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-[14px] font-normal outline-none transition focus:border-[#c99272] focus:ring-2 focus:ring-[#c99272]/15"
              placeholder="要完成什么？"
            />
          </label>
          <label className="block space-y-1.5 text-[12px] font-medium text-stone-700">
            <span>描述（选填）</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-28 w-full resize-y rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-[14px] font-normal outline-none transition focus:border-[#c99272] focus:ring-2 focus:ring-[#c99272]/15"
              placeholder="补充任务背景和完成标准"
            />
          </label>
          {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-[13px] font-medium text-stone-600 transition hover:bg-stone-100"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="rounded-xl bg-[#b87955] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#a96d4d] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "创建中..." : "创建任务"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function TaskPanel() {
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const tasks = useAtomValue(tasksAtom);
  const loading = useAtomValue(tasksLoadingAtom);
  const error = useAtomValue(tasksErrorAtom);
  const selectedTask = useAtomValue(selectedTaskAtom);
  const selectedTaskId = useAtomValue(selectedTaskIdAtom);
  const selectTask = useSetAtom(selectedTaskIdAtom);
  const loadTasks = useSetAtom(loadTasksAtom);
  const deleteTask = useSetAtom(deleteTaskAtom);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void loadTasks(workspaceId);
  }, [loadTasks, workspaceId]);

  useEffect(() => {
    return window.zora.onTasksChanged((changedWorkspaceId) => {
      if (changedWorkspaceId === workspaceId) {
        void loadTasks(workspaceId);
      }
    });
  }, [loadTasks, workspaceId]);

  const handleDelete = async () => {
    if (!selectedTask || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTask({ workspaceId, taskId: selectedTask.id });
    } catch (deleteTaskError) {
      setDeleteError(getErrorMessage(deleteTaskError));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 bg-white text-stone-900">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-stone-100 bg-[#fbfaf7]">
        <header className="titlebar-drag-region flex h-[50px] shrink-0 items-center justify-between border-b border-stone-100/80 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <TaskIcon className="h-[18px] w-[18px] shrink-0 text-[#b87955]" />
            <h1 className="truncate text-[15px] font-semibold">任务</h1>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">
              {tasks.length} 个
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="titlebar-no-drag rounded-lg bg-[#b87955] px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#a96d4d]"
          >
            + 新建任务
          </button>
        </header>

        <div className="titlebar-no-drag min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <p className="px-3 py-4 text-[12px] text-stone-400">正在加载...</p>
          ) : error ? (
            <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">
              {error}
            </p>
          ) : tasks.length === 0 ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center px-5 text-center">
              <TaskIcon className="h-8 w-8 text-stone-300" />
              <p className="mt-3 text-[13px] font-medium text-stone-600">还没有任务</p>
              <p className="mt-1 text-[12px] leading-5 text-stone-400">新建一条任务，开始整理当前项目。</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => selectTask(task.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition",
                    selectedTaskId === task.id
                      ? "bg-white shadow-sm ring-1 ring-stone-200/80"
                      : "hover:bg-white/70"
                  )}
                >
                  <span className="min-w-0 truncate text-[13px] font-medium text-stone-800">
                    {task.title}
                  </span>
                  <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-100">
                    todo
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="titlebar-drag-region h-[50px] shrink-0 border-b border-stone-100/80" />
        {selectedTask ? (
          <div className="titlebar-no-drag min-h-0 flex-1 overflow-y-auto p-8">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-100">
                    todo
                  </span>
                  <h2 className="mt-4 break-words text-[24px] font-semibold tracking-tight text-stone-950">
                    {selectedTask.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="shrink-0 rounded-xl border border-red-100 px-3 py-2 text-[12px] font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting ? "删除中..." : "删除"}
                </button>
              </div>
              <div className="mt-8">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-stone-400">描述</h3>
                <p className="mt-2 whitespace-pre-wrap text-[14px] leading-7 text-stone-700">
                  {selectedTask.description || "暂无描述"}
                </p>
              </div>
              <dl className="mt-10 grid grid-cols-2 gap-4 border-t border-stone-100 pt-6 text-[12px]">
                <div>
                  <dt className="text-stone-400">负责人</dt>
                  <dd className="mt-1 font-medium text-stone-700">{selectedTask.assignee}</dd>
                </div>
                <div>
                  <dt className="text-stone-400">触发方式</dt>
                  <dd className="mt-1 font-medium text-stone-700">manual</dd>
                </div>
              </dl>
              {deleteError ? <p className="mt-4 text-[12px] text-red-600">{deleteError}</p> : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] text-stone-400">
            选择一条任务查看详情
          </div>
        )}
      </section>

      {isCreateOpen ? (
        <CreateTaskDialog workspaceId={workspaceId} onClose={() => setIsCreateOpen(false)} />
      ) : null}
    </section>
  );
}
