import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  Task,
  TaskCreateInput,
  TaskStatus,
  TaskUpdateInput,
} from "../shared/types/task";
import { isEnoentError, replaceFileAtomically, ZORA_DIR } from "./utils/fs";
import { isRecord } from "./utils/guards";

const changeListeners = new Set<(workspaceId: string) => void>();
const workspaceWriteLocks = new Map<string, Promise<void>>();

function getTasksDir(workspaceId: string): string {
  return path.join(ZORA_DIR, "workspaces", workspaceId, "tasks");
}

function getTasksFile(workspaceId: string): string {
  return path.join(getTasksDir(workspaceId), "tasks.json");
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function normalizeWorkspaceId(workspaceId: string): string {
  return normalizeRequiredText(workspaceId, "workspaceId");
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    value === "backlog" ||
    value === "todo" ||
    value === "in_progress" ||
    value === "in_review" ||
    value === "done" ||
    value === "blocked" ||
    value === "cancelled"
  );
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function normalizeStoredTask(value: unknown): Task | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    !isTaskStatus(value.status) ||
    typeof value.assignee !== "string" ||
    value.trigger !== "manual" ||
    !Array.isArray(value.linkedSessionIds) ||
    !value.linkedSessionIds.every((item) => typeof item === "string") ||
    !Array.isArray(value.comments) ||
    value.comments.length !== 0 ||
    !isRecord(value.metadata) ||
    !isValidDate(value.createdAt) ||
    !isValidDate(value.updatedAt)
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    title: value.title,
    description: value.description,
    status: value.status,
    assignee: value.assignee,
    trigger: "manual",
    linkedSessionIds: [...value.linkedSessionIds],
    comments: [],
    metadata: { ...value.metadata },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function compareTasks(a: Task, b: Task): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

async function readTasks(workspaceId: string): Promise<Task[]> {
  try {
    const raw = await readFile(getTasksFile(workspaceId), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("tasks.json root must be an array.");
    }

    return parsed.map((item, index) => {
      const task = normalizeStoredTask(item);
      if (!task) {
        throw new Error(`tasks.json contains an invalid task at index ${index}.`);
      }
      return task;
    });
  } catch (error) {
    if (isEnoentError(error)) {
      return [];
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取任务失败：${message}`);
  }
}

async function writeTasks(workspaceId: string, tasks: Task[]): Promise<void> {
  await mkdir(getTasksDir(workspaceId), { recursive: true });
  await replaceFileAtomically(
    getTasksFile(workspaceId),
    JSON.stringify([...tasks].sort(compareTasks), null, 2)
  );
}

async function withWorkspaceWriteLock<T>(
  workspaceId: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = workspaceWriteLocks.get(workspaceId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => undefined).then(() => current);
  workspaceWriteLocks.set(workspaceId, chained);
  await previous.catch(() => undefined);

  try {
    return await operation();
  } finally {
    release();
    if (workspaceWriteLocks.get(workspaceId) === chained) {
      workspaceWriteLocks.delete(workspaceId);
    }
  }
}

function emitChanged(workspaceId: string): void {
  for (const listener of changeListeners) {
    listener(workspaceId);
  }
}

export function onTasksStoreChanged(
  listener: (workspaceId: string) => void
): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

export async function listTasks(workspaceId: string): Promise<Task[]> {
  return (await readTasks(normalizeWorkspaceId(workspaceId))).sort(compareTasks);
}

export async function getTask(
  workspaceId: string,
  taskId: string
): Promise<Task | null> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const normalizedTaskId = normalizeRequiredText(taskId, "taskId");
  const tasks = await readTasks(normalizedWorkspaceId);
  return tasks.find((task) => task.id === normalizedTaskId) ?? null;
}

export async function createTask(
  workspaceId: string,
  input: TaskCreateInput
): Promise<Task> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    workspaceId: normalizedWorkspaceId,
    title: normalizeRequiredText(input.title, "title"),
    description: input.description?.trim() ?? "",
    status: "todo",
    assignee: "zora",
    trigger: "manual",
    linkedSessionIds: [],
    comments: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };

  await withWorkspaceWriteLock(normalizedWorkspaceId, async () => {
    const tasks = await readTasks(normalizedWorkspaceId);
    await writeTasks(normalizedWorkspaceId, [task, ...tasks]);
  });
  emitChanged(normalizedWorkspaceId);
  return task;
}

export async function updateTask(input: TaskUpdateInput): Promise<Task> {
  const workspaceId = normalizeWorkspaceId(input.workspaceId);
  const taskId = normalizeRequiredText(input.taskId, "taskId");
  const updatedTask = await withWorkspaceWriteLock(workspaceId, async () => {
    const tasks = await readTasks(workspaceId);
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      throw new Error("Task not found.");
    }

    const current = tasks[index];
    const next: Task = {
      ...current,
      title:
        input.updates.title === undefined
          ? current.title
          : normalizeRequiredText(input.updates.title, "title"),
      description:
        input.updates.description === undefined
          ? current.description
          : input.updates.description.trim(),
      updatedAt: new Date().toISOString(),
    };
    tasks[index] = next;
    await writeTasks(workspaceId, tasks);
    return next;
  });
  emitChanged(workspaceId);
  return updatedTask;
}

export async function deleteTask(
  workspaceId: string,
  taskId: string
): Promise<void> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const normalizedTaskId = normalizeRequiredText(taskId, "taskId");
  await withWorkspaceWriteLock(normalizedWorkspaceId, async () => {
    const tasks = await readTasks(normalizedWorkspaceId);
    const nextTasks = tasks.filter((task) => task.id !== normalizedTaskId);
    if (nextTasks.length === tasks.length) {
      throw new Error("Task not found.");
    }
    await writeTasks(normalizedWorkspaceId, nextTasks);
  });
  emitChanged(normalizedWorkspaceId);
}
