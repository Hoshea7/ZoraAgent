import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type {
  ScheduledTask,
  ScheduledTaskSchedule,
  ScheduledTaskUpdateInput,
  Workspace,
} from "../../types";
import {
  isValidScheduleTime as isValidTime,
  normalizeScheduleWeekdays as normalizeWeekdays,
} from "../../../shared/types/schedule";
import {
  failTurnAtom,
  setSessionRunningAtom,
  startConversationAtom,
} from "../../store/chat";
import {
  deleteScheduledTaskAtom,
  loadScheduledTasksAtom,
  scheduledTasksAtom,
  scheduledTasksErrorAtom,
  scheduledTasksLoadingAtom,
  selectedScheduledTaskAtom,
  selectedScheduledTaskSelectionAtom,
  setScheduledTaskStatusAtom,
  updateScheduledTaskAtom,
} from "../../store/schedule";
import { activeMainViewAtom } from "../../store/ui";
import {
  createSessionAtom,
  currentWorkspaceIdAtom,
  switchWorkspaceAtom,
  workspacesAtom,
} from "../../store/workspace";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";

const WEEKDAY_OPTIONS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
] as const;

const TIME_OPTION_VALUES = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  return `${pad2(hour)}:${pad2(minute)}`;
});

const SCHEDULE_TYPE_OPTIONS = [
  { value: "once", label: "一次性" },
  { value: "hourly", label: "每小时" },
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周" },
] as const;

type ScheduleDraft =
  | {
      type: "once";
      runDate: string;
      runTime: string;
    }
  | {
      type: "hourly";
    }
  | {
      type: "daily";
      time: string;
    }
  | {
      type: "weekdays";
      time: string;
    }
  | {
      type: "weekly";
      weekdays: number[];
      time: string;
    };

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "未设置";
  }

  return `${formatDateInputValue(value)} ${formatTimeInputValue(value)}`;
}

function formatDateInputValue(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("-");
}

function formatTimeInputValue(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "09:00";
  }

  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function formatWeekdays(weekdays: number[]): string {
  const normalized = normalizeWeekdays(weekdays);

  if (normalized.length === 5 && normalized.every((weekday, index) => weekday === index + 1)) {
    return "工作日";
  }

  return normalized
    .map((weekday) => WEEKDAY_OPTIONS.find((option) => option.value === weekday)?.label)
    .filter(Boolean)
    .join("、");
}

function formatSchedule(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === "once") {
    return `一次性 ${formatDateTime(schedule.runAt)}`;
  }

  if (schedule.type === "daily") {
    return `每天 ${schedule.time}`;
  }

  if (schedule.type === "hourly") {
    return "每小时";
  }

  if (schedule.type === "weekdays") {
    return `工作日 ${schedule.time}`;
  }

  return `每周 ${formatWeekdays(schedule.weekdays)} ${schedule.time}`;
}

function getScheduleTypeLabel(type: ScheduleDraft["type"]): string {
  return SCHEDULE_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? "未设置";
}

function getStatusLabel(status: ScheduledTask["status"]): string {
  if (status === "paused") {
    return "已暂停";
  }

  return "活跃";
}

function buildScheduleDraft(schedule: ScheduledTaskSchedule): ScheduleDraft {
  if (schedule.type === "once") {
    return {
      type: "once",
      runDate: formatDateInputValue(schedule.runAt),
      runTime: formatTimeInputValue(schedule.runAt),
    };
  }

  if (schedule.type === "daily") {
    return {
      type: "daily",
      time: schedule.time,
    };
  }

  if (schedule.type === "hourly") {
    return {
      type: "hourly",
    };
  }

  if (schedule.type === "weekdays") {
    return {
      type: "weekdays",
      time: schedule.time,
    };
  }

  return {
    type: "weekly",
    weekdays: normalizeWeekdays(schedule.weekdays),
    time: schedule.time,
  };
}

function serializeScheduleDraft(draft: ScheduleDraft): string {
  if (draft.type === "weekly") {
    return JSON.stringify({
      ...draft,
      weekdays: normalizeWeekdays(draft.weekdays),
    });
  }

  return JSON.stringify(draft);
}

function normalizeTimeInputValue(value: string): string {
  return value.replace("：", ":").trim();
}

function getTimeOptions(value: string): string[] {
  const normalizedValue = normalizeTimeInputValue(value);

  if (!isValidTime(normalizedValue) || TIME_OPTION_VALUES.includes(normalizedValue)) {
    return TIME_OPTION_VALUES;
  }

  return [...TIME_OPTION_VALUES, normalizedValue].sort();
}

function buildLocalIsoDateTime(dateValue: string, timeValue: string): string {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);

  if (
    !year ||
    !month ||
    !day ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new Error("请选择有效的日期和时间。");
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (Number.isNaN(date.getTime())) {
    throw new Error("请选择有效的日期和时间。");
  }

  return date.toISOString();
}

function buildScheduleFromDraft(draft: ScheduleDraft): ScheduledTaskSchedule {
  if (draft.type === "once") {
    if (!isValidDateInput(draft.runDate) || !isValidTime(draft.runTime)) {
      throw new Error("一次性任务需要有效的日期和时间。");
    }

    const runAt = buildLocalIsoDateTime(draft.runDate, draft.runTime);

    if (new Date(runAt).getTime() <= Date.now()) {
      throw new Error("一次性任务时间必须晚于当前时间。");
    }

    return {
      type: "once",
      runAt,
    };
  }

  if (draft.type === "daily") {
    if (!isValidTime(draft.time)) {
      throw new Error("每天任务需要有效的运行时间。");
    }

    return {
      type: "daily",
      time: draft.time,
    };
  }

  if (draft.type === "hourly") {
    return {
      type: "hourly",
    };
  }

  if (draft.type === "weekdays") {
    if (!isValidTime(draft.time)) {
      throw new Error("工作日任务需要有效的运行时间。");
    }

    return {
      type: "weekdays",
      time: draft.time,
    };
  }

  const weekdays = normalizeWeekdays(draft.weekdays);

  if (weekdays.length === 0) {
    throw new Error("每周任务至少选择一天。");
  }

  if (!isValidTime(draft.time)) {
    throw new Error("每周任务需要有效的运行时间。");
  }

  return {
    type: "weekly",
    weekdays,
    time: draft.time,
  };
}

function getWorkspaceDisplay(workspaces: Workspace[], workspaceId: string) {
  const workspace = workspaces.find((item) => item.id === workspaceId);

  return {
    name: workspace?.name ?? workspaceId,
    path: workspace?.path,
  };
}

function useCloseOnOutsidePointer<T extends HTMLElement>(
  open: boolean,
  onClose: () => void
) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (
        target instanceof Node &&
        ref.current &&
        !ref.current.contains(target)
      ) {
        onCloseRef.current();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return ref;
}

function useDropdownPlacement<T extends HTMLElement>(
  open: boolean,
  rootRef: RefObject<T>,
  menuHeight = 220
): "top" | "bottom" {
  const [placement, setPlacement] = useState<"top" | "bottom">("bottom");

  useEffect(() => {
    if (!open || !rootRef.current) {
      return;
    }

    const updatePlacement = () => {
      if (!rootRef.current) {
        return;
      }

      const rect = rootRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      setPlacement(
        spaceBelow < menuHeight && spaceAbove > spaceBelow ? "top" : "bottom"
      );
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    return () => {
      window.removeEventListener("resize", updatePlacement);
    };
  }, [menuHeight, open, rootRef]);

  return placement;
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
        d="M12 6v6l3.5 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 5.5v13l11-6.5-11-6.5z"
      />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h5M20 20v-5h-5M6.2 17.8A8 8 0 019.6 4.8a8 8 0 018.2 1.9M17.8 6.2A8 8 0 0114.4 19.2a8 8 0 01-8.2-1.9"
      />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 9l6 6 6-6"
      />
    </svg>
  );
}

function StatusPill({ status }: { status: ScheduledTask["status"] }) {
  const isPaused = status === "paused";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium",
        isPaused
          ? "bg-stone-100 text-stone-500"
          : "bg-emerald-50 text-emerald-700"
      )}
    >
      {getStatusLabel(status)}
    </span>
  );
}

function ScheduleEmptyState() {
  return (
    <div className="flex h-full min-h-[360px] items-center justify-center px-7 pb-14 pt-6">
      <div className="max-w-[220px] text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-stone-900">
          <ClockIcon className="h-14 w-14" />
        </div>
        <h2 className="mt-4 text-[14px] font-semibold text-stone-800">
          暂无定时任务
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-stone-500">
          可以对 Zora 说“每天早上 8 点帮我查比特币价格”来创建。
        </p>
      </div>
    </div>
  );
}

function SelectTaskState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-8">
      <div className="max-w-[320px] text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-stone-300">
          <ClockIcon className="h-12 w-12" />
        </div>
        <h2 className="mt-4 text-[15px] font-medium text-stone-800">
          选择一个任务查看详情
        </h2>
      </div>
    </div>
  );
}

function ScheduleTaskListItem({
  task,
  selected,
  workspaceName,
  onSelect,
}: {
  task: ScheduledTask;
  selected: boolean;
  workspaceName: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group w-full rounded-[14px] border px-3 py-3 text-left transition-colors",
        selected
          ? "border-stone-200 bg-white shadow-sm ring-1 ring-stone-100"
          : "border-transparent hover:border-stone-200/70 hover:bg-white/65"
      )}
      aria-current={selected ? "page" : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate text-[13.5px] font-medium",
              task.status === "paused" ? "text-stone-500" : "text-stone-900"
            )}
          >
            {task.title}
          </div>
          <div className="mt-1 truncate text-[11.5px] text-stone-500">
            {formatSchedule(task.schedule)}
          </div>
          <div className="mt-1 truncate text-[11px] text-stone-400">
            {workspaceName} · 下次 {formatDateTime(task.nextRunAt)}
          </div>
        </div>
        <StatusPill status={task.status} />
      </div>
    </button>
  );
}

function CompactInfoItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-stone-50/75 px-3 py-2">
      <div className="text-[11.5px] font-medium text-stone-400">{label}</div>
      <div className="mt-1 min-w-0 text-[12.5px] leading-relaxed text-stone-800">
        {children}
      </div>
    </div>
  );
}

function DeleteTaskDialog({
  taskTitle,
  busy,
  onCancel,
  onConfirm,
}: {
  taskTitle: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/20 px-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-schedule-title"
        className="w-full max-w-[360px] rounded-2xl border border-stone-200 bg-[#fffdf9] p-5 shadow-[0_24px_60px_rgba(35,31,27,0.2)]"
      >
        <div
          id="delete-schedule-title"
          className="text-[15px] font-semibold text-stone-900"
        >
          删除定时任务？
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-stone-500">
          「{taskTitle}」删除后无法恢复。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-8 rounded-lg border border-stone-200 bg-white px-3 text-[12px] font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="h-8 rounded-lg bg-red-50 px-3 text-[12px] font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "删除中" : "删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TimePickerField({
  label,
  value,
  onChange,
  disabled,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    setOpen(false)
  );
  const placement = useDropdownPlacement(open, rootRef, 190);
  const options = useMemo(() => getTimeOptions(value), [value]);
  const normalizedValue = normalizeTimeInputValue(value);

  return (
    <div ref={rootRef} className="block min-w-0">
      {label ? (
        <div className="text-[12px] font-medium text-stone-500">{label}</div>
      ) : null}
      <div className={cn("relative", label ? "mt-1.5" : "")}>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setOpen(false);
            }

            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              event.currentTarget.blur();
            }
          }}
          onChange={(event) => onChange(normalizeTimeInputValue(event.target.value))}
          disabled={disabled}
          placeholder="09:00"
          className={cn(
            "h-10 w-full rounded-xl border bg-white px-3 pr-9 text-[13px] text-stone-800 outline-none transition",
            isValidTime(normalizedValue) || value.length === 0
              ? "border-stone-200 focus:border-stone-300 focus:ring-4 focus:ring-stone-100"
              : "border-red-200 focus:border-red-300 focus:ring-4 focus:ring-red-50",
            disabled ? "cursor-not-allowed bg-stone-50 text-stone-400" : ""
          )}
          aria-label="时间"
          aria-invalid={value.length > 0 && !isValidTime(normalizedValue)}
        />
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((current) => !current)}
          className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="选择时间"
          aria-expanded={open}
        >
          <ClockIcon className="h-3.5 w-3.5" />
        </button>

        {open && !disabled ? (
          <div
            className={cn(
              "absolute left-0 right-0 z-20 max-h-44 overflow-y-auto rounded-xl border border-stone-200 bg-white p-1 shadow-[0_12px_28px_rgba(35,31,27,0.1)]",
              placement === "top" ? "bottom-full mb-1" : "top-full mt-1"
            )}
          >
            {options.map((option) => {
              const selected = option === normalizedValue;

              return (
                <button
                  key={option}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-8 w-full items-center rounded-lg px-3 text-left text-[13px] transition",
                    selected
                      ? "bg-stone-100 text-stone-900"
                      : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ScheduleTypeSelect({
  value,
  onChange,
  disabled,
}: {
  value: ScheduleDraft["type"];
  onChange: (value: ScheduleDraft["type"]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    setOpen(false)
  );
  const placement = useDropdownPlacement(open, rootRef, 190);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-3 text-left text-[13px] text-stone-800 outline-none transition hover:border-stone-300 focus:border-stone-300 focus:ring-4 focus:ring-stone-100 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400"
        aria-label="周期"
        aria-expanded={open}
      >
        <span>{getScheduleTypeLabel(value)}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 text-stone-400" />
      </button>

      {open && !disabled ? (
        <div
          className={cn(
            "absolute left-0 right-0 z-30 overflow-hidden rounded-xl border border-stone-200 bg-white p-1 shadow-[0_14px_30px_rgba(35,31,27,0.12)]",
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1"
          )}
        >
          {SCHEDULE_TYPE_OPTIONS.map((option) => {
            const selected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-8 w-full items-center rounded-lg px-3 text-left text-[13px] transition",
                  selected
                    ? "bg-stone-100 text-stone-900"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function getDraftTime(value: ScheduleDraft): string {
  if (value.type === "once") {
    return value.runTime;
  }

  if (value.type === "hourly") {
    return "09:00";
  }

  return value.time;
}

function getCurrentWeekday(): number {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

function ScheduleRuleEditor({
  value,
  onChange,
  disabled,
}: {
  value: ScheduleDraft;
  onChange: (value: ScheduleDraft) => void;
  disabled: boolean;
}) {
  const switchType = (type: ScheduleDraft["type"]) => {
    if (type === value.type) {
      return;
    }

    const fallbackTime = getDraftTime(value);

    if (type === "once") {
      const now = new Date();
      now.setHours(now.getHours() + 1, 0, 0, 0);
      onChange({
        type: "once",
        runDate: formatDateInputValue(now.toISOString()),
        runTime: formatTimeInputValue(now.toISOString()),
      });
      return;
    }

    if (type === "hourly") {
      onChange({
        type: "hourly",
      });
      return;
    }

    if (type === "daily" || type === "weekdays") {
      onChange({
        type,
        time: fallbackTime,
      });
      return;
    }

    onChange({
      type: "weekly",
      weekdays: [getCurrentWeekday()],
      time: fallbackTime,
    });
  };

  const toggleWeekday = (weekday: number) => {
    if (value.type !== "weekly") {
      return;
    }

    const exists = value.weekdays.includes(weekday);
    const nextWeekdays = exists
      ? value.weekdays.filter((item) => item !== weekday)
      : [...value.weekdays, weekday];

    onChange({
      ...value,
      weekdays: normalizeWeekdays(nextWeekdays),
    });
  };

  const updateTime = (time: string) => {
    if (value.type === "once") {
      onChange({
        ...value,
        runTime: time,
      });
      return;
    }

    if (value.type === "hourly") {
      return;
    }

    onChange({
      ...value,
      time,
    });
  };

  return (
    <div className="border-b border-stone-100 pb-3">
      <div className="text-[12px] font-medium text-stone-400">时间规则</div>

      <div
        className={cn(
          "mt-2 grid gap-3",
          value.type === "hourly"
            ? "sm:grid-cols-[minmax(128px,220px)]"
            : "sm:grid-cols-[minmax(128px,0.48fr)_minmax(0,1fr)]"
        )}
      >
        <div className="block min-w-0">
          <ScheduleTypeSelect
            value={value.type}
            onChange={switchType}
            disabled={disabled}
          />
        </div>

        {value.type === "once" ? (
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <div className="min-w-0">
              <input
                type="text"
                inputMode="numeric"
                value={value.runDate}
                onChange={(event) =>
                  onChange({
                    ...value,
                    runDate: event.target.value,
                  })
                }
                disabled={disabled}
                placeholder="2026-05-15"
                className={cn(
                  "h-10 w-full rounded-xl border bg-white px-3 text-[13px] text-stone-800 outline-none transition disabled:cursor-not-allowed disabled:bg-stone-50",
                  isValidDateInput(value.runDate) || value.runDate.length === 0
                    ? "border-stone-200 hover:border-stone-300 focus:border-stone-300 focus:ring-4 focus:ring-stone-100"
                    : "border-red-200 focus:border-red-300 focus:ring-4 focus:ring-red-50"
                )}
                aria-label="日期"
                aria-invalid={value.runDate.length > 0 && !isValidDateInput(value.runDate)}
                required
              />
            </div>
            <TimePickerField
              value={value.runTime}
              onChange={updateTime}
              disabled={disabled}
            />
          </div>
        ) : value.type === "hourly" ? null : (
          <TimePickerField
            value={value.time}
            onChange={updateTime}
            disabled={disabled}
          />
        )}
      </div>

      {value.type === "weekly" ? (
        <div className="mt-2.5">
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_OPTIONS.map((option) => {
              const selected = value.weekdays.includes(option.value);

              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleWeekday(option.value)}
                  className={cn(
                    "h-8 min-w-[48px] rounded-full border px-2.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
                    selected
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 bg-white text-stone-500 hover:border-stone-300 hover:text-stone-800"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

    </div>
  );
}

function WorkspaceSelect({
  value,
  workspaces,
  onChange,
  disabled,
}: {
  value: string;
  workspaces: Workspace[];
  onChange: (workspaceId: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedWorkspace = getWorkspaceDisplay(workspaces, value);
  const rootRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    setOpen(false)
  );
  const placement = "top";

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-2.5 text-left text-[12px] text-stone-700 outline-none transition hover:border-stone-300 focus:border-stone-300 focus:ring-4 focus:ring-stone-100 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400"
        aria-label="工作区"
        aria-expanded={open}
      >
        <span className="min-w-0 truncate">{selectedWorkspace.name}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-stone-400" />
      </button>

      {open && !disabled ? (
        <div
          className={cn(
            "absolute left-0 right-0 z-30 max-h-40 overflow-y-auto rounded-xl border border-stone-200 bg-white p-1 shadow-[0_14px_30px_rgba(35,31,27,0.12)]",
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1"
          )}
        >
          {workspaces.map((workspace) => {
            const selected = workspace.id === value;

            return (
              <button
                key={workspace.id}
                type="button"
                title={workspace.path}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(workspace.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-8 w-full items-center rounded-lg px-2.5 text-left text-[12px] transition",
                  selected
                    ? "bg-stone-100 text-stone-900"
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                )}
              >
                <span className="min-w-0 truncate">{workspace.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ScheduledTaskDetail({
  task,
  workspaces,
  currentWorkspaceId,
}: {
  task: ScheduledTask;
  workspaces: Workspace[];
  currentWorkspaceId: string;
}) {
  const setStatus = useSetAtom(setScheduledTaskStatusAtom);
  const deleteTask = useSetAtom(deleteScheduledTaskAtom);
  const updateTask = useSetAtom(updateScheduledTaskAtom);
  const switchWorkspace = useSetAtom(switchWorkspaceAtom);
  const createSession = useSetAtom(createSessionAtom);
  const startConversation = useSetAtom(startConversationAtom);
  const failTurn = useSetAtom(failTurnAtom);
  const setSessionRunning = useSetAtom(setSessionRunningAtom);
  const setActiveMainView = useSetAtom(activeMainViewAtom);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.executionPrompt);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(
    buildScheduleDraft(task.schedule)
  );
  const [workspaceIdDraft, setWorkspaceIdDraft] = useState(task.workspaceId);
  const [busy, setBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPaused = task.status === "paused";
  const initialScheduleDraft = useMemo(
    () => buildScheduleDraft(task.schedule),
    [task.schedule]
  );
  const titleChanged = title.trim() !== task.title;
  const descriptionChanged = description.trim() !== task.executionPrompt;
  const workspaceChanged = workspaceIdDraft !== task.workspaceId;
  const scheduleChanged =
    serializeScheduleDraft(scheduleDraft) !== serializeScheduleDraft(initialScheduleDraft);
  const hasChanges = titleChanged || descriptionChanged || scheduleChanged || workspaceChanged;

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.executionPrompt);
    setScheduleDraft(buildScheduleDraft(task.schedule));
    setWorkspaceIdDraft(task.workspaceId);
    setError(null);
  }, [task.id, task.title, task.executionPrompt, task.schedule, task.workspaceId]);

  const handleToggleStatus = async () => {
    setBusy(true);
    setError(null);

    try {
      await setStatus({
        taskId: task.id,
        workspaceId: task.workspaceId,
        status: isPaused ? "active" : "paused",
      });
    } catch (toggleError) {
      setError(getErrorMessage(toggleError));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setError(null);

    try {
      await deleteTask({
        taskId: task.id,
        workspaceId: task.workspaceId,
      });
      setDeleteDialogOpen(false);
    } catch (deleteError) {
      setDeleteDialogOpen(false);
      setError(getErrorMessage(deleteError));
    } finally {
      setBusy(false);
    }
  };

  const handleRunNow = async () => {
    if (runBusy) {
      return;
    }

    setRunBusy(true);
    setError(null);

    let sessionId: string | null = null;
    const runPrompt = description.trim();

    try {
      if (!runPrompt) {
        throw new Error("定时任务描述不能为空。");
      }

      if (workspaceIdDraft !== currentWorkspaceId) {
        await switchWorkspace(workspaceIdDraft);
      }

      sessionId = await createSession(`执行：${title.trim() || task.title}`);
      setActiveMainView("chat");
      const userMessageId = startConversation(runPrompt);
      await window.zora.chat(
        runPrompt,
        sessionId,
        userMessageId,
        workspaceIdDraft
      );
    } catch (runError) {
      const message = getErrorMessage(runError);

      if (sessionId) {
        if (message.includes("An agent is already running for session")) {
          setSessionRunning(sessionId, true);
          failTurn(
            sessionId,
            "当前会话里还有一个 Agent 在运行，请先等待它结束，或点击停止按钮终止后再继续。"
          );
        } else {
          failTurn(sessionId, message);
        }
      }

      setError(message);
    } finally {
      setRunBusy(false);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const updates: ScheduledTaskUpdateInput["updates"] = {};

      if (titleChanged) {
        updates.title = title;
      }

      if (descriptionChanged) {
        updates.executionPrompt = description;
      }

      if (scheduleChanged) {
        updates.schedule = buildScheduleFromDraft(scheduleDraft);
      }

      if (workspaceChanged) {
        updates.workspaceId = workspaceIdDraft;
      }

      if (Object.keys(updates).length > 0) {
        await updateTask({
          taskId: task.id,
          workspaceId: task.workspaceId,
          updates,
        });
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {deleteDialogOpen ? (
        <DeleteTaskDialog
          taskTitle={task.title}
          busy={busy}
          onCancel={() => setDeleteDialogOpen(false)}
          onConfirm={() => void handleDelete()}
        />
      ) : null}
      <header className="titlebar-drag-region flex h-[50px] shrink-0 items-center justify-end border-b border-stone-100/80 px-10">
        <div className="titlebar-no-drag flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => void handleRunNow()}
            disabled={runBusy || busy}
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-stone-900 px-2.5 text-[11.5px] font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
          >
            <PlayIcon className="h-3 w-3" />
            {runBusy ? "运行中" : "立即运行"}
          </button>
          <button
            type="button"
            onClick={() => void handleToggleStatus()}
            disabled={busy || runBusy}
            className="h-7 rounded-lg border border-stone-200 bg-white px-2.5 text-[11.5px] font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPaused ? "恢复" : "暂停"}
          </button>
          <button
            type="button"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={busy || runBusy}
            className="h-7 rounded-lg px-2 text-[11.5px] font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            删除
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-10 py-4">
        <div className="mx-auto flex h-full max-w-[940px] flex-col">
          {error ? (
            <div className="mb-3 shrink-0 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">
              {error}
            </div>
          ) : null}

          <form
            onSubmit={(event) => void handleSave(event)}
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            <div className="shrink-0">
              <label
                htmlFor="schedule-title"
                className="text-[12px] font-medium text-stone-400"
              >
                定时任务名称
              </label>
              <input
                id="schedule-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1.5 block h-9 w-full rounded-xl border border-stone-200/80 bg-[#fffdf9] px-3.5 text-[14px] font-medium text-stone-900 outline-none transition placeholder:text-stone-300 focus:border-[#d4aa8b] focus:ring-4 focus:ring-[#c9875f]/10 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={busy || runBusy}
                placeholder="定时任务名称"
                required
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <label
                htmlFor="schedule-description"
                className="text-[12px] font-medium text-stone-400"
              >
                定时任务描述
              </label>
              <textarea
                id="schedule-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-1.5 block min-h-[300px] flex-1 resize-none overflow-y-auto rounded-2xl border border-stone-200/80 bg-[#fffdf9] px-4 py-3.5 text-[14px] leading-[1.65] text-stone-800 outline-none transition placeholder:text-stone-300 focus:border-[#d4aa8b] focus:ring-4 focus:ring-[#c9875f]/10 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={busy || runBusy}
                placeholder="写下这个定时任务要执行的内容..."
                required
              />
            </div>
            <div className="shrink-0 rounded-2xl border border-stone-100 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(35,31,27,0.03)]">
              <ScheduleRuleEditor
                value={scheduleDraft}
                onChange={setScheduleDraft}
                disabled={busy || runBusy}
              />
              <div className="grid grid-cols-1 gap-2.5 pt-2.5 sm:grid-cols-3">
                <CompactInfoItem label="工作区">
                  <div className="min-w-0">
                    <WorkspaceSelect
                      value={workspaceIdDraft}
                      workspaces={workspaces}
                      onChange={setWorkspaceIdDraft}
                      disabled={busy || runBusy}
                    />
                  </div>
                </CompactInfoItem>
                <CompactInfoItem label="下次运行">{formatDateTime(task.nextRunAt)}</CompactInfoItem>
                <CompactInfoItem label="运行统计">
                  已运行 {task.runCount} 次，失败 {task.failureCount} 次
                </CompactInfoItem>
              </div>
              <div className="flex justify-end pt-2.5">
                <button
                  type="submit"
                  disabled={busy || runBusy || !hasChanges}
                  className="h-9 rounded-xl bg-stone-900 px-5 text-[13px] font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                >
                  保存
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export function SchedulePage() {
  const tasks = useAtomValue(scheduledTasksAtom);
  const loading = useAtomValue(scheduledTasksLoadingAtom);
  const error = useAtomValue(scheduledTasksErrorAtom);
  const selectedTask = useAtomValue(selectedScheduledTaskAtom);
  const selectedTaskSelection = useAtomValue(selectedScheduledTaskSelectionAtom);
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom);
  const workspaces = useAtomValue(workspacesAtom);
  const loadTasks = useSetAtom(loadScheduledTasksAtom);
  const setSelectedTaskSelection = useSetAtom(selectedScheduledTaskSelectionAtom);

  const taskCountLabel = useMemo(() => {
    if (tasks.length === 0) {
      return "0 个";
    }

    return `${tasks.length} 个`;
  }, [tasks.length]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    return window.zora.onScheduledTasksChanged(() => {
      void loadTasks();
    });
  }, [loadTasks]);

  return (
    <section className="flex h-full flex-col overflow-hidden bg-white text-stone-900">
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-stone-100 bg-[#fbfaf7]">
          <header className="titlebar-drag-region flex h-[50px] shrink-0 items-center border-b border-stone-100/80 px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <ClockIcon className="h-[18px] w-[18px] shrink-0 text-[#b87955]" />
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-stone-900">
                定时任务
              </h1>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">
                {taskCountLabel}
              </span>
              <button
                type="button"
                className="titlebar-no-drag ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-900/[0.04] hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10"
                aria-label="刷新定时任务"
                title="刷新"
                onClick={() => void loadTasks()}
              >
                <RefreshIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </header>

          <div className="titlebar-no-drag min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {loading ? (
              <div className="px-3 py-4 text-[12px] text-stone-400">正在加载...</div>
            ) : error ? (
              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-600">
                {error}
              </div>
            ) : tasks.length === 0 ? (
              <ScheduleEmptyState />
            ) : (
              <div className="space-y-1.5">
                {tasks.map((task) => {
                  const workspace = getWorkspaceDisplay(workspaces, task.workspaceId);

                  return (
                    <ScheduleTaskListItem
                      key={`${task.workspaceId}:${task.id}`}
                      task={task}
                      workspaceName={workspace.name}
                      selected={
                        selectedTaskSelection !== null &&
                        task.id === selectedTaskSelection.taskId &&
                        task.workspaceId === selectedTaskSelection.workspaceId
                      }
                      onSelect={() => {
                        setSelectedTaskSelection({
                          taskId: task.id,
                          workspaceId: task.workspaceId,
                        });
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-white">
          {selectedTask ? (
            <ScheduledTaskDetail
              key={`${selectedTask.workspaceId}:${selectedTask.id}`}
              task={selectedTask}
              workspaces={workspaces}
              currentWorkspaceId={currentWorkspaceId}
            />
          ) : (
            <>
              <div className="titlebar-drag-region h-[50px] shrink-0 border-b border-stone-100/80" />
              <SelectTaskState />
            </>
          )}
        </section>
      </div>
    </section>
  );
}
