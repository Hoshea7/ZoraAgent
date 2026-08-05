import { atom } from "jotai";
import type { Task, TaskCreateInput, TaskUpdateInput } from "../../shared/types/task";
import { getErrorMessage } from "../utils/message";

export const tasksAtom = atom<Task[]>([]);
export const selectedTaskIdAtom = atom<string | null>(null);
export const tasksLoadingAtom = atom(false);
export const tasksErrorAtom = atom<string | null>(null);
const tasksLoadRequestIdAtom = atom(0);

export const selectedTaskAtom = atom((get) => {
  const selectedId = get(selectedTaskIdAtom);
  return get(tasksAtom).find((task) => task.id === selectedId) ?? null;
});

export const loadTasksAtom = atom(
  null,
  async (get, set, workspaceId: string) => {
    const requestId = get(tasksLoadRequestIdAtom) + 1;
    set(tasksLoadRequestIdAtom, requestId);
    set(tasksLoadingAtom, true);
    set(tasksErrorAtom, null);

    try {
      const tasks = await window.zora.listTasks(workspaceId);
      if (get(tasksLoadRequestIdAtom) !== requestId) {
        return tasks;
      }
      set(tasksAtom, tasks);
      set(selectedTaskIdAtom, (current) => {
        if (current && tasks.some((task) => task.id === current)) {
          return current;
        }
        return tasks[0]?.id ?? null;
      });
      return tasks;
    } catch (error) {
      if (get(tasksLoadRequestIdAtom) === requestId) {
        set(tasksAtom, []);
        set(selectedTaskIdAtom, null);
        set(tasksErrorAtom, getErrorMessage(error));
      }
      return [];
    } finally {
      if (get(tasksLoadRequestIdAtom) === requestId) {
        set(tasksLoadingAtom, false);
      }
    }
  }
);

export const createTaskAtom = atom(
  null,
  async (
    _get,
    set,
    input: { workspaceId: string; task: TaskCreateInput }
  ) => {
    const task = await window.zora.createTask(input.workspaceId, input.task);
    await set(loadTasksAtom, input.workspaceId);
    set(selectedTaskIdAtom, task.id);
    return task;
  }
);

export const updateTaskAtom = atom(
  null,
  async (_get, set, input: TaskUpdateInput) => {
    const task = await window.zora.updateTask(input);
    await set(loadTasksAtom, input.workspaceId);
    set(selectedTaskIdAtom, task.id);
    return task;
  }
);

export const deleteTaskAtom = atom(
  null,
  async (
    _get,
    set,
    input: { workspaceId: string; taskId: string }
  ) => {
    await window.zora.deleteTask(input.workspaceId, input.taskId);
    return set(loadTasksAtom, input.workspaceId);
  }
);
