import { randomUUID } from "node:crypto";
import type { AgentStreamEvent } from "../shared/zora";
import type { ScheduledTask } from "../shared/types/schedule";
import {
  createSession,
  getSessionMeta,
  loadMessages,
} from "./session-store";
import { runPromptInSession } from "./session-runner";
import {
  claimDueScheduledTask,
  listAllScheduledTasks,
  onScheduledTasksStoreChanged,
  recordScheduledTaskRun,
} from "./schedule-store";
import { getErrorMessage, logSystemEvent, startSystemOperation } from "./system-log";

const SCHEDULE_INITIAL_CHECK_DELAY_MS = 1_000;
const SCHEDULE_STORE_CHANGE_DEBOUNCE_MS = 100;
const SCHEDULE_RETRY_DELAY_MS = 30_000;
const SCHEDULE_MAX_TIMER_DELAY_MS = 5 * 60_000;

interface StartScheduleRunnerOptions {
  forwardEvent: (sessionId: string, payload: AgentStreamEvent) => void;
}

type RecordScheduledTaskRun = typeof recordScheduledTaskRun;

function getTaskKey(task: ScheduledTask): string {
  return `${task.workspaceId}:${task.id}`;
}

function getNextScheduledDelayMs(
  tasks: ScheduledTask[],
  now: Date,
  inFlightTasks: Set<string>
): number | null {
  let nextRunAt: number | null = null;

  for (const task of tasks) {
    if (task.status !== "active" || inFlightTasks.has(getTaskKey(task))) {
      continue;
    }

    const runAt = new Date(task.nextRunAt).getTime();

    if (Number.isNaN(runAt)) {
      continue;
    }

    if (nextRunAt === null || runAt < nextRunAt) {
      nextRunAt = runAt;
    }
  }

  if (nextRunAt === null) {
    return null;
  }

  return Math.max(
    0,
    Math.min(nextRunAt - now.getTime(), SCHEDULE_MAX_TIMER_DELAY_MS)
  );
}

function createScheduledSessionTitle(task: ScheduledTask): string {
  return `执行：${task.title}`;
}

async function notifySessionSync(
  sessionId: string,
  runId: string,
  workspaceId: string,
  forwardEvent: StartScheduleRunnerOptions["forwardEvent"]
): Promise<void> {
  const [session, messages] = await Promise.all([
    getSessionMeta(sessionId, workspaceId),
    loadMessages(sessionId, workspaceId),
  ]);

  forwardEvent(sessionId, {
    type: "session_sync",
    source: "schedule",
    sessionId,
    runId,
    workspaceId,
    session,
    messages,
  });
}

async function runScheduledTask(
  task: ScheduledTask,
  forwardEvent: StartScheduleRunnerOptions["forwardEvent"],
  recordTaskRun: RecordScheduledTaskRun = recordScheduledTaskRun
): Promise<void> {
  let success = false;
  const workspaceId = task.workspaceId;
  const operation = startSystemOperation("schedule", "task", {
    taskId: task.id,
    workspaceId,
  });

  try {
    operation.log("pre", "start", "开始执行定时任务", {
      title: task.title,
      schedule: task.schedule.type,
    });

    const session = await createSession(createScheduledSessionTitle(task), workspaceId);
    const runId = randomUUID();
    operation.log("runtime", "session:create", "已创建定时任务会话", {
      sessionId: session.id,
      runId,
    });

    await runPromptInSession({
      sessionId: session.id,
      workspaceId,
      text: task.executionPrompt.trim(),
      source: "schedule",
      waitForCompletion: true,
      beforeRun: () =>
        notifySessionSync(session.id, runId, workspaceId, forwardEvent),
      forwardEvent: (payload) => {
        forwardEvent(session.id, payload);
      },
    });

    success = true;
  } catch (error) {
    operation.log(
      "runtime",
      "run:error",
      "定时任务执行失败",
      { error: getErrorMessage(error) },
      { level: "error" }
    );
  } finally {
    try {
      await recordTaskRun(task.id, workspaceId, { success });
      operation.end(
        success ? "success" : "failure",
        "定时任务执行结束",
        { success },
        { level: success ? "info" : "warn" }
      );
    } catch (error) {
      operation.end(
        "failure",
        "定时任务结果记录失败",
        { success, error: getErrorMessage(error) },
        { level: "error" }
      );
    }
  }
}

export function startScheduleRunner({
  forwardEvent,
}: StartScheduleRunnerOptions): () => void {
  const inFlightTasks = new Set<string>();
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  let checking = false;
  let rerunAfterCheck = false;
  let stopped = false;
  let runnerStoreWriteDepth = 0;

  const clearCheckTimer = () => {
    if (checkTimer) {
      clearTimeout(checkTimer);
      checkTimer = null;
    }
  };

  const scheduleCheck = (delayMs = 0) => {
    if (stopped) {
      return;
    }

    clearCheckTimer();
    checkTimer = setTimeout(() => {
      checkTimer = null;
      void checkDueTasks();
    }, Math.max(0, delayMs));
  };

  const scheduleNextCheck = async (tasks?: ScheduledTask[], now = new Date()) => {
    if (stopped) {
      return;
    }

    const taskSnapshot = tasks ?? (await listAllScheduledTasks());
    const nextDelayMs = getNextScheduledDelayMs(taskSnapshot, now, inFlightTasks);

    if (nextDelayMs === null) {
      clearCheckTimer();
      return;
    }

    scheduleCheck(nextDelayMs);
  };

  const withoutRunnerStoreReaction = async <T,>(
    operation: () => Promise<T>
  ): Promise<T> => {
    runnerStoreWriteDepth += 1;

    try {
      return await operation();
    } finally {
      runnerStoreWriteDepth = Math.max(0, runnerStoreWriteDepth - 1);
    }
  };

  const checkDueTasks = async () => {
    if (stopped) {
      return;
    }

    if (checking) {
      rerunAfterCheck = true;
      return;
    }

    checking = true;

    try {
      const now = new Date();
      const tasks = await listAllScheduledTasks();
      const dueTasks = tasks.filter((task) => {
        const key = getTaskKey(task);
        const runAt = new Date(task.nextRunAt).getTime();

        return (
          task.status === "active" &&
          !Number.isNaN(runAt) &&
          runAt <= now.getTime() &&
          !inFlightTasks.has(key)
        );
      });

      const claimedTasks = (
        await withoutRunnerStoreReaction(() =>
          Promise.all(
            dueTasks.map((task) =>
              claimDueScheduledTask(task.id, task.workspaceId, now)
            )
          )
        )
      ).filter((task): task is ScheduledTask => Boolean(task));

      for (const task of claimedTasks) {
        const key = getTaskKey(task);
        inFlightTasks.add(key);
        void runScheduledTask(
          task,
          forwardEvent,
          (taskId, workspaceId, result) =>
            withoutRunnerStoreReaction(() =>
              recordScheduledTaskRun(taskId, workspaceId, result)
            )
        ).finally(() => {
          inFlightTasks.delete(key);
          if (!stopped) {
            scheduleCheck(SCHEDULE_STORE_CHANGE_DEBOUNCE_MS);
          }
        });
      }

      await scheduleNextCheck(claimedTasks.length > 0 ? undefined : tasks, now);
    } catch (error) {
      logSystemEvent(
        "schedule",
        "runner",
        "scan:error",
        "扫描定时任务失败，稍后重试",
        { retryAfterMs: SCHEDULE_RETRY_DELAY_MS, error: getErrorMessage(error) },
        { level: "error" }
      );
      scheduleCheck(SCHEDULE_RETRY_DELAY_MS);
    } finally {
      checking = false;

      if (rerunAfterCheck && !stopped) {
        rerunAfterCheck = false;
        scheduleCheck(SCHEDULE_STORE_CHANGE_DEBOUNCE_MS);
      }
    }
  };

  const unsubscribeStore = onScheduledTasksStoreChanged(() => {
    if (runnerStoreWriteDepth > 0) {
      return;
    }

    if (checking) {
      rerunAfterCheck = true;
      return;
    }

    scheduleCheck(SCHEDULE_STORE_CHANGE_DEBOUNCE_MS);
  });

  scheduleCheck(SCHEDULE_INITIAL_CHECK_DELAY_MS);

  return () => {
    stopped = true;
    unsubscribeStore();
    clearCheckTimer();
  };
}
