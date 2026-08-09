import type {
  ScheduledTask,
  ScheduledTaskDetailLink,
  ScheduledTaskSchedule,
  ScheduledTaskUpdateInput,
} from "../../shared/types/schedule";
import { isValidScheduleTime } from "../../shared/types/schedule";
import {
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listAllScheduledTasks,
  listScheduledTasks,
  updateScheduledTask,
} from "../schedule-store";

export const ZORA_SCHEDULE_SERVER_NAME = "zora_schedule";
export const ZORA_SCHEDULE_MANAGE_TOOL_NAME = "zora_schedule_manage";
export const ZORA_SCHEDULE_MANAGE_FULL_TOOL_NAME =
  `mcp__${ZORA_SCHEDULE_SERVER_NAME}__${ZORA_SCHEDULE_MANAGE_TOOL_NAME}`;

export const ZORA_SCHEDULE_MANAGE_DESCRIPTION = `
管理 Zora 本地定时任务。用于用户明确要求创建、查看、查看详情、修改、暂停、恢复或删除定时任务时。

这个工具只管理定时任务配置，不会立即执行任务。定时任务到点后，Zora 会在指定 workspace 下新建一个普通会话，并发送保存好的定时任务描述（executionPrompt）。

action=create 用于保存一个已经明确的定时任务。调用前，Agent 应该已经确认时间规则和任务内容明确。

executionPrompt 是定时任务描述，也是未来新会话执行任务时收到的提示词。它要忠于用户意图。简单任务可以很短，只要写清任务目标和输出方式；复杂任务需要补充背景、输入来源、执行要求、输出要求和边界。不要为了填结构而编造上下文。

如果用户给出的时间或任务内容不明确，先向用户澄清，不要调用 create。

Zora 定时任务只能使用本工具管理。不要使用 CronCreate、Claude Code cron、系统 crontab 或其他临时 cron/automation 工具替代。如果本工具参数校验失败，修正参数后继续调用本工具。

当用户要查看有哪些任务时，使用 action=list。list 会返回所有工作区的定时任务，并在每个任务里包含 workspaceId。当用户要查看某个任务的完整描述或详情时，使用 action=get。

当用户要查看详情、修改、暂停、恢复或删除任务但没有提供明确 taskId 时，先使用 action=list 查找候选任务，不要猜 taskId。对已有任务执行 get、update、pause、resume、delete 时，workspaceId 必须使用 list/get 返回的该任务 workspaceId，不要默认使用当前工作区。候选不唯一时，先向用户确认。

schedule 支持：
- once：一次性任务，runAt 必须是未来 ISO 时间；
- hourly：每小时运行一次；
- daily：每天固定时间，time 必须是 HH:mm；
- weekdays：工作日固定时间运行，time 必须是 HH:mm；
- weekly：每周指定星期运行，weekdays 使用 1=周一 到 7=周日，time 必须是 HH:mm。
`;

type ScheduleManageAction =
  | "create"
  | "list"
  | "get"
  | "update"
  | "pause"
  | "resume"
  | "delete";

interface ScheduleManageArgs {
  action: ScheduleManageAction;
  workspaceId?: string;
  taskId?: string;
  title?: string;
  executionPrompt?: string;
  schedule?: ScheduledTaskSchedule;
  updates?: {
    workspaceId?: string;
    title?: string;
    executionPrompt?: string;
    schedule?: ScheduledTaskSchedule;
  };
}

function createTextResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function createErrorResult(action: ScheduleManageAction | undefined, error: unknown) {
  return {
    isError: true,
    ...createTextResult({
      success: false,
      action,
      error: error instanceof Error ? error.message : String(error),
    }),
  };
}

function normalizeRequiredString(value: string | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    throw new Error(`${fieldName} 不能为空。`);
  }

  return normalized;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : undefined;
}

function ensureTaskId(args: ScheduleManageArgs): string {
  return normalizeRequiredString(
    args.taskId,
    "taskId。update、pause、resume、delete 需要 taskId；如果用户没有明确指定任务，请先使用 action=list 查找候选任务"
  );
}

function validateTitle(title: string): void {
  if (title.length > 40) {
    throw new Error("title 过长。请压缩为不超过 40 个中文字符左右的短标题。");
  }
}

function validateExecutionPrompt(executionPrompt: string): void {
  const normalized = executionPrompt.trim();

  if (!normalized) {
    throw new Error(
      "executionPrompt 不能为空。请先把明确的定时任务诉求整理成未来新会话可执行的提示词。"
    );
  }

  if (normalized.length > 6000) {
    throw new Error(
      "executionPrompt 过长。请压缩到未来执行所需的关键信息。"
    );
  }
}

function validateSchedule(schedule: ScheduledTaskSchedule): void {
  if (schedule.type === "once") {
    const runAt = new Date(schedule.runAt);

    if (Number.isNaN(runAt.getTime())) {
      throw new Error("schedule.runAt 必须是有效的未来 ISO 时间。");
    }

    if (runAt.getTime() <= Date.now()) {
      throw new Error("schedule.runAt 必须晚于当前时间。");
    }

    return;
  }

  if (schedule.type === "hourly") {
    return;
  }

  if (!isValidScheduleTime(schedule.time)) {
    throw new Error("schedule.time 必须使用 HH:mm 格式。");
  }

  if (schedule.type === "weekly") {
    const uniqueWeekdays = new Set(schedule.weekdays);
    if (schedule.weekdays.length === 0 || uniqueWeekdays.size !== schedule.weekdays.length) {
      throw new Error("schedule.weekdays 必须包含至少一个不重复的星期值。");
    }
  }
}

function summarizeTask(task: ScheduledTask) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    schedule: task.schedule,
    nextRunAt: task.nextRunAt,
    workspaceId: task.workspaceId,
  };
}

function createDetailLink(task: ScheduledTask): ScheduledTaskDetailLink {
  return {
    type: "zora-schedule-task",
    workspaceId: task.workspaceId,
    taskId: task.id,
    label: "查看定时任务",
  };
}

function truncatePreview(value: string, maxLength = 80): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function buildUpdateInput(
  args: ScheduleManageArgs,
  workspaceId: string,
  taskId: string
): ScheduledTaskUpdateInput {
  const updates = args.updates ?? {};
  const normalizedUpdates: ScheduledTaskUpdateInput["updates"] = {};

  const title = normalizeOptionalString(updates.title);
  if (title !== undefined) {
    validateTitle(title);
    normalizedUpdates.title = title;
  }

  const nextWorkspaceId = normalizeOptionalString(updates.workspaceId);
  if (nextWorkspaceId !== undefined) {
    normalizedUpdates.workspaceId = nextWorkspaceId;
  }

  const executionPrompt = normalizeOptionalString(updates.executionPrompt);
  if (executionPrompt !== undefined) {
    validateExecutionPrompt(executionPrompt);
    normalizedUpdates.executionPrompt = executionPrompt;
  }

  if (updates.schedule !== undefined) {
    validateSchedule(updates.schedule);
    normalizedUpdates.schedule = updates.schedule;
  }

  if (Object.keys(normalizedUpdates).length === 0) {
    throw new Error("updates 不能为空。update 操作只传需要修改的字段。");
  }

  return {
    taskId,
    workspaceId,
    updates: normalizedUpdates,
  };
}

export async function handleScheduleManage(args: ScheduleManageArgs) {
  if (args.action === "list") {
    const workspaceId = normalizeOptionalString(args.workspaceId);
    const tasks = workspaceId
      ? await listScheduledTasks(workspaceId)
      : await listAllScheduledTasks();

    return createTextResult({
      success: true,
      action: "list",
      count: tasks.length,
      tasks: tasks.map((task) => ({
        id: task.id,
        workspaceId: task.workspaceId,
        title: task.title,
        status: task.status,
        schedule: task.schedule,
        nextRunAt: task.nextRunAt,
        descriptionPreview: truncatePreview(task.executionPrompt),
      })),
    });
  }

  const workspaceId = normalizeRequiredString(args.workspaceId, "workspaceId");

  if (args.action === "create") {
    const title = normalizeRequiredString(args.title, "title");
    const executionPrompt = normalizeRequiredString(
      args.executionPrompt,
      "executionPrompt"
    );

    if (!args.schedule) {
      throw new Error("schedule 不能为空。create 操作必须提供定时规则。");
    }

    validateTitle(title);
    validateSchedule(args.schedule);
    validateExecutionPrompt(executionPrompt);

    const task = await createScheduledTask({
      workspaceId,
      title,
      executionPrompt,
      schedule: args.schedule,
    });

    return createTextResult({
      success: true,
      action: "create",
      task: summarizeTask(task),
      detailLink: createDetailLink(task),
    });
  }

  const taskId = ensureTaskId(args);

  if (args.action === "get") {
    const task = await getScheduledTask(taskId, workspaceId);

    if (!task) {
      throw new Error(
        `找不到 id 为 ${taskId} 的定时任务。请先使用 action=list 查询当前任务。`
      );
    }

    return createTextResult({
      success: true,
      action: "get",
      task,
      detailLink: createDetailLink(task),
    });
  }

  if (args.action === "delete") {
    await deleteScheduledTask(taskId, workspaceId);

    return createTextResult({
      success: true,
      action: "delete",
      taskId,
      workspaceId,
    });
  }

  if (args.action === "pause" || args.action === "resume") {
    const task = await updateScheduledTask({
      taskId,
      workspaceId,
      updates: {
        status: args.action === "pause" ? "paused" : "active",
      },
    });

    return createTextResult({
      success: true,
      action: args.action,
      task: summarizeTask(task),
      detailLink: createDetailLink(task),
    });
  }

  const task = await updateScheduledTask(buildUpdateInput(args, workspaceId, taskId));

  return createTextResult({
    success: true,
    action: "update",
    task: summarizeTask(task),
    detailLink: createDetailLink(task),
  });
}

export async function executeScheduleManage(args: Record<string, unknown>) {
  try {
    return await handleScheduleManage(args as unknown as ScheduleManageArgs);
  } catch (error) {
    return createErrorResult(
      (args as Partial<ScheduleManageArgs>).action,
      error
    );
  }
}
