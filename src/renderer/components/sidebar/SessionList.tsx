import { useAtomValue, useSetAtom } from "jotai";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { runningSessionsAtom } from "../../store/chat";
import {
  pendingAskUserQuestionsBySessionAtom,
  pendingPermissionsBySessionAtom,
} from "../../store/hitl";
import { activeMainViewAtom, isSettingsOpenAtom } from "../../store/ui";
import {
  DEFAULT_WORKSPACE_ID,
  archiveSessionAtom,
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  deleteWorkspaceAtom,
  pinnedWorkspaceIdsAtom,
  pinnedSessionIdsAtom,
  renameWorkspaceAtom,
  renameSessionAtom,
  reorderSessionsAtom,
  reorderWorkspacesAtom,
  startNewChatInWorkspaceAtom,
  switchWorkspaceSessionAtom,
  togglePinSessionAtom,
  togglePinWorkspaceAtom,
  workspaceSessionGroupsAtom,
} from "../../store/workspace";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import type { Session, Workspace } from "../../types";
import { ArchiveIcon, TrashIcon, CopyIcon, CheckIcon } from "../ui/Icons";
import { SubtaskArchiveDialog } from "./SubtaskArchiveDialog";

type SessionStatus = "needs-input" | "running" | "current" | "idle";

interface SessionListProps {
  searchQuery?: string;
  onCreateProject?: () => void;
}

interface WorkspaceGroupView {
  workspace: Workspace;
  sessions: Session[];
  loaded: boolean;
  status: SessionStatus;
}

const PATH_PREVIEW_DELAY_MS = 720;
const PROJECT_SESSION_PREVIEW_COUNT = 4;

type SessionWithWorkspace = {
  session: Session;
  workspaceId: string;
};

type DropPlacement = "before" | "after";
type SidebarDragItem =
  | { type: "workspace"; workspaceId: string }
  | {
      type: "session";
      workspaceId: string;
      sessionId: string;
      parentSessionId: string | null;
    };
type SidebarDropTarget = {
  type: SidebarDragItem["type"];
  id: string;
  placement: DropPlacement;
};

function getDropPlacement(event: DragEvent<HTMLElement>): DropPlacement {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function areSetsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function FolderIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={cn(
        "h-4 w-4 shrink-0",
        expanded ? "text-stone-700" : "text-stone-500"
      )}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {expanded ? (
        <>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M3.75 8.5V7.75A2.25 2.25 0 016 5.5h3.05c.55 0 1.08.2 1.49.56l1.1.96c.41.36.94.56 1.49.56H17.5c1.1 0 2 .9 2 2v.67"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M4.25 9.75h15.1c.96 0 1.68.9 1.46 1.83l-1.18 4.9a2.5 2.5 0 01-2.43 1.92H6.1a2.5 2.5 0 01-2.44-3.06l.95-4.05a2 2 0 011.95-1.54z"
          />
        </>
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.9}
          d="M3.75 7.5A2.25 2.25 0 016 5.25h3.4c.55 0 1.08.2 1.49.56l1.22 1.08c.41.36.94.56 1.49.56H18A2.25 2.25 0 0120.25 9.7v6.8A2.25 2.25 0 0118 18.75H6a2.25 2.25 0 01-2.25-2.25v-9z"
        />
      )}
    </svg>
  );
}

function StatusDot({ status }: { status: SessionStatus }) {
  if (status === "needs-input") {
    return (
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d77a70]/45 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#bf665d]" />
      </span>
    );
  }

  if (status === "running") {
    return (
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d6a37e]/45 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#b87955]" />
      </span>
    );
  }

  if (status === "current") {
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#b87955]" />;
  }

  return (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-stone-300/90 bg-transparent" />
  );
}

function WorkspaceBadge({ status }: { status: SessionStatus }) {
  if (status === "needs-input") {
    return (
      <span className="flex shrink-0 justify-end">
        <span className="rounded-full bg-[#fff4f2] px-2 py-0.5 text-[10px] font-medium text-[#bf665d] ring-1 ring-[#efd0cc]">
          待确认
        </span>
      </span>
    );
  }

  if (status === "running") {
    return (
      <span className="flex shrink-0 justify-end">
        <span className="rounded-full bg-[#fff6ef] px-2 py-0.5 text-[10px] font-medium text-[#b87955] ring-1 ring-[#efd9c7]">
          运行中
        </span>
      </span>
    );
  }

  return null;
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M14.45 4.15l4.9 4.9-2.9 2.9.38 5.45-1.18 1.18L5.42 8.35 6.6 7.17l5.45.38 2.4-3.4z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M10.95 13.05L5.1 18.9"
      />
    </svg>
  );
}

function RenameIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
        d="M4.5 19.5h15M6.25 15.75l.7-3.5 8.3-8.3a1.77 1.77 0 012.5 0l.3.3a1.77 1.77 0 010 2.5l-8.3 8.3-3.5.7z"
      />
    </svg>
  );
}

function EllipsisIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 12h.01M12 12h.01M19 12h.01"
      />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4v16m8-8H4"
      />
    </svg>
  );
}

function SectionChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={cn(
        "h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform duration-150",
        collapsed ? "-rotate-90" : "rotate-0"
      )}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.2}
        d="M6 9l6 6 6-6"
      />
    </svg>
  );
}

function SectionHeader({
  label,
  collapsed,
  onToggle,
  actions,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="group/section flex h-7 items-center gap-1 px-1">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-base font-medium leading-[18px] text-stone-400 transition hover:text-stone-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300/70"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span className="truncate">{label}</span>
        <SectionChevronIcon collapsed={collapsed} />
      </button>
      {actions ? (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function formatSessionTime(value: string): string {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return "刚刚";
  }

  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)}分钟`;
  }

  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}小时`;
  }

  if (diffMs < 7 * day) {
    return `${Math.floor(diffMs / day)}天`;
  }

  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

function getSessionStatus(
  sessionId: string,
  currentSessionId: string | null,
  runningSessions: Set<string>,
  pendingPermissionsBySession: Record<string, unknown[]>,
  pendingAskUserQuestionsBySession: Record<string, unknown[]>
): SessionStatus {
  if (
    (pendingPermissionsBySession[sessionId]?.length ?? 0) > 0 ||
    (pendingAskUserQuestionsBySession[sessionId]?.length ?? 0) > 0
  ) {
    return "needs-input";
  }

  if (runningSessions.has(sessionId)) {
    return "running";
  }

  if (currentSessionId === sessionId) {
    return "current";
  }

  return "idle";
}

function getWorkspaceStatus(
  sessions: Session[],
  currentSessionId: string | null,
  runningSessions: Set<string>,
  pendingPermissionsBySession: Record<string, unknown[]>,
  pendingAskUserQuestionsBySession: Record<string, unknown[]>
): SessionStatus {
  let hasCurrent = false;
  let hasRunning = false;

  for (const session of sessions) {
    const liveStatus = getSessionStatus(
      session.id,
      currentSessionId,
      runningSessions,
      pendingPermissionsBySession,
      pendingAskUserQuestionsBySession
    );
    const status = session.delegationStatus === "running" ? "running" : liveStatus;

    if (status === "needs-input") {
      return "needs-input";
    }

    if (status === "running") {
      hasRunning = true;
    }

    if (status === "current") {
      hasCurrent = true;
    }
  }

  if (hasRunning) {
    return "running";
  }

  if (hasCurrent) {
    return "current";
  }

  return "idle";
}

function matchesQuery(workspace: Workspace, session: Session, query: string) {
  if (!query) {
    return true;
  }

  const workspaceLabel =
    workspace.id === DEFAULT_WORKSPACE_ID ? "对话" : workspace.name;

  return (
    workspaceLabel.toLowerCase().includes(query) ||
    session.title.toLowerCase().includes(query)
  );
}

const SessionRow = memo(function SessionRow({
  session,
  workspaceId,
  status,
  isActive,
  isPinned,
  onSwitch,
  childCount,
  completedChildCount,
  childrenCollapsed,
  onToggleChildren,
  dragEnabled,
  isDragging,
  dropPlacement,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  session: Session;
  workspaceId: string;
  status: SessionStatus;
  isActive: boolean;
  isPinned: boolean;
  onSwitch: (workspaceId: string, sessionId: string) => void;
  childCount: number;
  completedChildCount: number;
  childrenCollapsed: boolean;
  onToggleChildren?: () => void;
  dragEnabled: boolean;
  isDragging: boolean;
  dropPlacement: DropPlacement | null;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const archiveSession = useSetAtom(archiveSessionAtom);
  const renameSession = useSetAtom(renameSessionAtom);
  const togglePinSession = useSetAtom(togglePinSessionAtom);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const archiveDisabledReason =
    status === "running"
      ? "会话运行中，结束后再归档"
      : status === "needs-input"
        ? "会话待确认，处理后再归档"
        : undefined;

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();

    if (trimmed.length > 0 && trimmed !== session.title) {
      renameSession({
        sessionId: session.id,
        title: trimmed,
        workspaceId,
      });
    }

    setRenaming(false);
    setRenameValue("");
  };

  const runArchive = (scope: "session" | "family") => {
    setArchiveDialogOpen(false);
    void archiveSession({
      sessionId: session.id,
      workspaceId,
      scope,
    }).catch((error) => {
      window.alert(getErrorMessage(error) || "归档会话失败，请稍后再试。");
    });
  };

  const handleArchive = () => {
    if (archiveDisabledReason) {
      return;
    }

    setMenuOpen(false);
    if (session.parentSessionId) {
      setArchiveDialogOpen(true);
      return;
    }
    runArchive("family");
  };

  const handleCopyPath = async () => {
    setMenuOpen(false);
    try {
      const filePath = await window.zora.getSessionFilePath(
        session.id,
        workspaceId
      );
      await navigator.clipboard.writeText(filePath);
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 1600);
    } catch {
      // clipboard API may be unavailable in some contexts
    }
  };

  return (
    <>
    <div
      role="button"
      tabIndex={renaming ? -1 : 0}
      draggable={dragEnabled && !renaming}
      data-session-id={session.id}
      data-testid={childCount > 0 ? "parent-session-row" : undefined}
      className={cn(
        "group/session relative flex cursor-pointer items-center border px-2 py-0 text-left transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10",
        session.parentSessionId
          ? "ml-[18px] h-[29px] gap-1.5 rounded-[7px]"
          : "h-[29px] gap-2 rounded-[8px]",
        isActive
          ? session.parentSessionId
            ? "border-transparent bg-white/55"
            : "border-transparent bg-white/65"
          : "border-transparent hover:bg-white/50",
        isDragging && "opacity-45"
      )}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (!renaming) {
          onSwitch(workspaceId, session.id);
        }
      }}
      onKeyDown={(event) => {
        if (renaming) {
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSwitch(workspaceId, session.id);
        }
      }}
    >
      {dropPlacement ? (
        <span
          data-testid="session-drop-indicator"
          className={cn(
            "pointer-events-none absolute left-1 right-1 z-20 h-0.5 rounded-full bg-[#b87955]",
            dropPlacement === "before" ? "-top-[2px]" : "-bottom-[2px]"
          )}
        />
      ) : null}
      <StatusDot status={status} />

      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={handleRenameSubmit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleRenameSubmit();
              }

              if (event.key === "Escape") {
                event.preventDefault();
                setRenaming(false);
                setRenameValue("");
              }
            }}
            className="h-7 w-full rounded-md bg-white px-2 text-[13px] text-stone-900 outline-none ring-1 ring-inset ring-stone-200 focus:ring-2 focus:ring-stone-900/10"
          />
        ) : (
          <div
            className="flex min-w-0 items-center gap-1.5"
            title={
              session.parentSessionId
                ? `${session.title} · ${session.delegationRole ?? "custom"} · ${session.providerId ?? "unknown"}/${session.selectedModelId ?? "unknown"}`
                : session.title
            }
          >
            {isPinned ? (
              <PinIcon className="h-3 w-3 shrink-0 text-stone-400" />
            ) : null}
            <span
              className={cn(
                "min-w-0 truncate text-sm leading-[17px]",
                isActive
                  ? "font-medium text-stone-900"
                  : session.parentSessionId
                    ? "font-normal text-stone-500 group-hover/session:text-stone-900"
                    : "font-normal text-stone-600 group-hover/session:text-stone-950"
              )}
            >
              {session.title}
            </span>
            {session.parentSessionId ? (
              <span
                className={cn(
                  "shrink-0 text-[10px] font-medium leading-4",
                  session.delegationStatus === "completed"
                    ? "sr-only"
                    : session.delegationStatus === "failed"
                      ? "text-[#bf665d]"
                      : "text-stone-400"
                )}
                data-testid="subtask-status"
              >
                {session.delegationStatus === "running"
                  ? "运行中"
                  : session.delegationStatus === "completed"
                    ? "已完成"
                    : session.delegationStatus === "cancelled"
                      ? "已停止"
                      : session.delegationStatus === "failed"
                        ? "失败"
                        : "已中断"}
              </span>
            ) : childCount > 0 ? (
              <span className="flex shrink-0 items-center gap-0.5">
                <span
                  className="text-xs tabular-nums leading-4 text-stone-400"
                  data-testid="subtask-progress"
                >
                  {completedChildCount}/{childCount}
                </span>
                <button
                  type="button"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-900/[0.05] hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleChildren?.();
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  aria-expanded={!childrenCollapsed}
                  aria-label={childrenCollapsed ? "展开子任务" : "收起子任务"}
                >
                  <SectionChevronIcon collapsed={childrenCollapsed} />
                </button>
              </span>
            ) : null}
          </div>
        )}
      </div>

      {!renaming ? (
        <div
          className="relative h-6 w-[42px] shrink-0"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span
            className={cn(
              "absolute right-0 top-1/2 -translate-y-1/2 text-right text-xs tabular-nums text-stone-400 transition-opacity",
              status === "running" && "text-[#b87955]",
              status === "needs-input" && "text-[#bf665d]",
              copied
                ? "opacity-100"
                : hovered || menuOpen
                  ? "opacity-0"
                  : "opacity-100"
            )}
          >
            {copied ? (
              <span
                className="flex items-center justify-end text-[#7a9b6e]"
                aria-label="已复制"
                title="已复制"
              >
                <CheckIcon className="h-3 w-3" />
              </span>
            ) : status === "running"
              ? "运行中"
              : status === "needs-input"
                ? "待确认"
                : formatSessionTime(session.updatedAt)}
          </span>

          <DropdownMenu.Root
            open={menuOpen}
            onOpenChange={(open) => setMenuOpen(open)}
          >
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className={cn(
                  "absolute right-0 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-stone-400 opacity-0 transition",
                  "hover:bg-stone-900/[0.05] hover:text-stone-700",
                  "focus-visible:opacity-100 focus-visible:outline-none",
                  (hovered || menuOpen) && !copied && "opacity-100",
                  menuOpen && "bg-white text-stone-800 ring-1 ring-stone-200/70"
                )}
                aria-label={`打开${session.title}的操作菜单`}
              >
                <EllipsisIcon className="h-3.5 w-3.5" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className={cn(
                  "z-50 w-[128px] overflow-hidden rounded-[10px]",
                  "bg-white/95",
                  "ring-1 ring-stone-200/90 shadow-[0_8px_18px_rgba(41,37,36,0.10)]",
                  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                )}
              >
                <div className="px-0.5 py-0.5">
                  <DropdownMenu.Item
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-stone-700 transition-colors focus:bg-stone-900/[0.04] focus:outline-none data-[highlighted]:bg-stone-900/[0.04]"
                    onSelect={() => togglePinSession(session.id)}
                  >
                    <PinIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                    <span>{isPinned ? "取消置顶" : "置顶"}</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="mt-0.5 flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-stone-700 transition-colors focus:bg-stone-900/[0.04] focus:outline-none data-[highlighted]:bg-stone-900/[0.04]"
                    onSelect={() => {
                      setRenameValue(session.title);
                      setRenaming(true);
                    }}
                  >
                    <RenameIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                    <span>重命名</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="mt-0.5 flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-stone-700 transition-colors focus:bg-stone-900/[0.04] focus:outline-none data-[highlighted]:bg-stone-900/[0.04]"
                    onSelect={handleCopyPath}
                  >
                    <CopyIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                    <span>复制会话路径</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={Boolean(archiveDisabledReason)}
                    title={archiveDisabledReason}
                    className="mt-0.5 flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-stone-700 transition-colors focus:bg-stone-900/[0.04] focus:outline-none data-[disabled]:cursor-not-allowed data-[disabled]:bg-transparent data-[disabled]:text-stone-300 data-[highlighted]:bg-stone-900/[0.04]"
                    onSelect={handleArchive}
                  >
                    <ArchiveIcon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        archiveDisabledReason ? "text-stone-300" : "text-stone-500"
                      )}
                    />
                    <span>归档</span>
                  </DropdownMenu.Item>
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      ) : null}
    </div>
    {archiveDialogOpen ? (
      <SubtaskArchiveDialog
        title={session.title}
        onCancel={() => setArchiveDialogOpen(false)}
        onArchiveFamily={() => runArchive("family")}
        onArchiveSubtask={() => runArchive("session")}
      />
    ) : null}
    </>
  );
});

export function SessionList({
  searchQuery = "",
  onCreateProject,
}: SessionListProps) {
  const groups = useAtomValue(workspaceSessionGroupsAtom);
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const runningSessions = useAtomValue(runningSessionsAtom);
  const pendingPermissionsBySession = useAtomValue(pendingPermissionsBySessionAtom);
  const pendingAskUserQuestionsBySession = useAtomValue(pendingAskUserQuestionsBySessionAtom);
  const activeMainView = useAtomValue(activeMainViewAtom);
  const isChatView = activeMainView === "chat";
  const currentSessionIdForStatus = isChatView ? currentSessionId : null;
  const pinnedWorkspaceIds = useAtomValue(pinnedWorkspaceIdsAtom);
  const pinnedSessionIds = useAtomValue(pinnedSessionIdsAtom);
  const switchWorkspaceSession = useSetAtom(switchWorkspaceSessionAtom);
  const startNewChatInWorkspace = useSetAtom(startNewChatInWorkspaceAtom);
  const deleteWorkspace = useSetAtom(deleteWorkspaceAtom);
  const renameWorkspace = useSetAtom(renameWorkspaceAtom);
  const togglePinWorkspace = useSetAtom(togglePinWorkspaceAtom);
  const reorderWorkspaces = useSetAtom(reorderWorkspacesAtom);
  const reorderSessions = useSetAtom(reorderSessionsAtom);
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(
    new Set()
  );
  const [userCollapsedWorkspaceIds, setUserCollapsedWorkspaceIds] = useState<
    Set<string>
  >(new Set());
  const [showAllWorkspaceIds, setShowAllWorkspaceIds] = useState<Set<string>>(
    new Set()
  );
  const [workspaceMenuOpenId, setWorkspaceMenuOpenId] = useState<string | null>(
    null
  );
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(
    null
  );
  const [workspaceRenameValue, setWorkspaceRenameValue] = useState("");
  const [pathPreviewWorkspaceId, setPathPreviewWorkspaceId] = useState<
    string | null
  >(null);
  const [workspaceActionError, setWorkspaceActionError] = useState<string | null>(
    null
  );
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [conversationsCollapsed, setConversationsCollapsed] = useState(false);
  const [collapsedParentSessionIds, setCollapsedParentSessionIds] = useState<Set<string>>(
    new Set()
  );
  const [draggedItem, setDraggedItem] = useState<SidebarDragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget | null>(null);
  const draggedItemRef = useRef<SidebarDragItem | null>(null);
  const initializedParentCollapseRef = useRef(false);
  const pathPreviewTimerRef = useRef<number | null>(null);
  const workspaceActionErrorTimerRef = useRef<number | null>(null);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const startSidebarDrag = (
    event: DragEvent<HTMLElement>,
    item: SidebarDragItem
  ) => {
    event.stopPropagation();
    draggedItemRef.current = item;
    setDraggedItem(item);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.type);
  };

  const finishSidebarDrag = () => {
    draggedItemRef.current = null;
    setDraggedItem(null);
    setDropTarget(null);
  };

  const groupViews = useMemo<WorkspaceGroupView[]>(() => {
    return groups.flatMap((group) => {
      const workspaceLabel =
        group.workspace.id === DEFAULT_WORKSPACE_ID ? "对话" : group.workspace.name;
      const workspaceMatches =
        normalizedSearchQuery.length > 0 &&
        workspaceLabel.toLowerCase().includes(normalizedSearchQuery);
      const sessions = normalizedSearchQuery
        ? group.sessions.filter((session) =>
            matchesQuery(group.workspace, session, normalizedSearchQuery)
          )
        : group.sessions;

      if (normalizedSearchQuery && !workspaceMatches && sessions.length === 0) {
        return [];
      }

      const sessionsForWorkspaceStatus = group.sessions.filter(
        (session) => !pinnedSessionIds.has(session.id)
      );

      return [
        {
          workspace: group.workspace,
          sessions: workspaceMatches ? group.sessions : sessions,
          loaded: group.loaded,
          status: getWorkspaceStatus(
            sessionsForWorkspaceStatus,
            currentSessionIdForStatus,
            runningSessions,
            pendingPermissionsBySession,
            pendingAskUserQuestionsBySession
          ),
        },
      ];
    });
  }, [
    currentSessionIdForStatus,
    groups,
    normalizedSearchQuery,
    pendingAskUserQuestionsBySession,
    pendingPermissionsBySession,
    pinnedSessionIds,
    runningSessions,
  ]);

  useEffect(() => {
    setExpandedWorkspaceIds((current) => {
      const next = new Set(current);

      const activeSessionWorkspaceId = currentSessionIdForStatus
        ? groupViews.find((group) =>
            group.sessions.some((session) => session.id === currentSessionIdForStatus)
          )?.workspace.id
        : undefined;

      if (
        activeSessionWorkspaceId &&
        !userCollapsedWorkspaceIds.has(activeSessionWorkspaceId)
      ) {
        next.add(activeSessionWorkspaceId);
      }

      if (
        groups.length === 1 &&
        !userCollapsedWorkspaceIds.has(groups[0].workspace.id)
      ) {
        next.add(groups[0].workspace.id);
      }

      for (const group of groupViews) {
        if (
          (group.status === "running" || group.status === "needs-input") &&
          !userCollapsedWorkspaceIds.has(group.workspace.id)
        ) {
          next.add(group.workspace.id);
        }
      }

      return areSetsEqual(next, current) ? current : next;
    });
  }, [currentSessionIdForStatus, groups, groupViews, userCollapsedWorkspaceIds]);

  useEffect(() => {
    if (initializedParentCollapseRef.current) {
      return;
    }

    const loadedGroups = groups.filter((group) => group.loaded);
    if (loadedGroups.length === 0) {
      return;
    }

    const initiallyCollapsed = new Set<string>();
    for (const group of loadedGroups) {
      const childrenByParent = new Map<string, Session[]>();
      for (const session of group.sessions) {
        if (!session.parentSessionId) {
          continue;
        }
        const siblings = childrenByParent.get(session.parentSessionId) ?? [];
        siblings.push(session);
        childrenByParent.set(session.parentSessionId, siblings);
      }

      for (const [parentId, children] of childrenByParent) {
        const containsCurrentSession = children.some(
          (child) => child.id === currentSessionIdForStatus
        );
        const allSettled = children.every(
          (child) => child.delegationStatus !== "running"
        );
        if (allSettled && !containsCurrentSession) {
          initiallyCollapsed.add(parentId);
        }
      }
    }

    setCollapsedParentSessionIds(initiallyCollapsed);
    initializedParentCollapseRef.current = true;
  }, [currentSessionIdForStatus, groups]);

  useEffect(() => {
    return () => {
      if (pathPreviewTimerRef.current !== null) {
        window.clearTimeout(pathPreviewTimerRef.current);
      }
      if (workspaceActionErrorTimerRef.current !== null) {
        window.clearTimeout(workspaceActionErrorTimerRef.current);
      }
    };
  }, []);

  const showWorkspaceActionError = (error: unknown, fallback: string) => {
    const rawMessage = getErrorMessage(error);
    const message = rawMessage.includes("workspace:rename")
      ? "重命名接口已更新，重启 Zora 后即可生效。"
      : rawMessage || fallback;

    setWorkspaceActionError(message);

    if (workspaceActionErrorTimerRef.current !== null) {
      window.clearTimeout(workspaceActionErrorTimerRef.current);
    }

    workspaceActionErrorTimerRef.current = window.setTimeout(() => {
      setWorkspaceActionError(null);
      workspaceActionErrorTimerRef.current = null;
    }, 4200);
  };

  const handlePathPreviewEnter = (workspaceId: string) => {
    if (pathPreviewTimerRef.current !== null) {
      window.clearTimeout(pathPreviewTimerRef.current);
    }

    pathPreviewTimerRef.current = window.setTimeout(() => {
      setPathPreviewWorkspaceId(workspaceId);
      pathPreviewTimerRef.current = null;
    }, PATH_PREVIEW_DELAY_MS);
  };

  const handlePathPreviewLeave = () => {
    if (pathPreviewTimerRef.current !== null) {
      window.clearTimeout(pathPreviewTimerRef.current);
      pathPreviewTimerRef.current = null;
    }

    setPathPreviewWorkspaceId(null);
  };

  const handleSwitchSession = useCallback(
    (workspaceId: string, sessionId: string) => {
      void switchWorkspaceSession({ workspaceId, sessionId });
      setSettingsOpen(false);
    },
    [switchWorkspaceSession, setSettingsOpen]
  );

  const handleToggleWorkspace = (workspaceId: string) => {
    setPathPreviewWorkspaceId(null);
    const shouldCollapse = expandedWorkspaceIds.has(workspaceId);

    setExpandedWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
    setUserCollapsedWorkspaceIds((current) => {
      const next = new Set(current);
      if (shouldCollapse) {
        next.add(workspaceId);
      } else {
        next.delete(workspaceId);
      }
      return next;
    });
  };

  const handleToggleShowAll = (workspaceId: string) => {
    setShowAllWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  };

  const handleNewChatInWorkspace = (workspaceId: string) => {
    void startNewChatInWorkspace(workspaceId);
    setExpandedWorkspaceIds((current) => new Set(current).add(workspaceId));
    setUserCollapsedWorkspaceIds((current) => {
      if (!current.has(workspaceId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(workspaceId);
      return next;
    });
    setSettingsOpen(false);
  };

  const handleDeleteWorkspace = async (workspace: Workspace) => {
    if (workspace.id === DEFAULT_WORKSPACE_ID) {
      return;
    }

    if (
      !window.confirm(
        `确定删除项目「${workspace.name}」？该项目下的本地会话数据也会被移除。`
      )
    ) {
      return;
    }

    try {
      await deleteWorkspace(workspace.id);
    } catch (error) {
      showWorkspaceActionError(error, "删除项目失败，请稍后再试。");
    }
  };

  const handleRenameWorkspaceSubmit = async (workspace: Workspace) => {
    const nextName = workspaceRenameValue.trim();
    setRenamingWorkspaceId(null);
    setWorkspaceRenameValue("");

    if (!nextName || nextName === workspace.name) {
      return;
    }

    try {
      await renameWorkspace({
        workspaceId: workspace.id,
        name: nextName,
      });
    } catch (error) {
      showWorkspaceActionError(error, "重命名项目失败，请稍后再试。");
    }
  };

  const defaultGroup = groupViews.find(
    (group) => group.workspace.id === DEFAULT_WORKSPACE_ID
  );
  const projectGroups = groupViews.filter(
    (group) => group.workspace.id !== DEFAULT_WORKSPACE_ID
  );
  const pinnedSessionViews = groupViews
    .flatMap<SessionWithWorkspace>((group) =>
      group.sessions
        .filter((session) => pinnedSessionIds.has(session.id))
        .map((session) => ({
          session,
          workspaceId: group.workspace.id,
        }))
    )
    .sort(
      (left, right) =>
        new Date(right.session.updatedAt).getTime() -
        new Date(left.session.updatedAt).getTime()
    );
  const pinnedSessionIdSet = new Set(
    pinnedSessionViews.map((item) => item.session.id)
  );
  for (const group of groupViews) {
    for (const session of group.sessions) {
      if (
        session.parentSessionId &&
        pinnedSessionIdSet.has(session.parentSessionId)
      ) {
        pinnedSessionIdSet.add(session.id);
      }
    }
  }
  const isSearchActive = normalizedSearchQuery.length > 0;
  const arePinnedCollapsed = !isSearchActive && pinnedCollapsed;
  const areProjectsCollapsed = !isSearchActive && projectsCollapsed;
  const areConversationsCollapsed = !isSearchActive && conversationsCollapsed;
  const defaultSessions =
    defaultGroup?.sessions.filter((session) => !pinnedSessionIdSet.has(session.id)) ??
    [];

  const toggleParentChildren = (parentSessionId: string) => {
    setCollapsedParentSessionIds((current) => {
      const next = new Set(current);
      if (next.has(parentSessionId)) {
        next.delete(parentSessionId);
      } else {
        next.add(parentSessionId);
      }
      return next;
    });
  };

  const canDropSessionOn = (target: Session, workspaceId: string) => {
    const source = draggedItemRef.current;
    return (
      source?.type === "session" &&
      source.workspaceId === workspaceId &&
      source.sessionId !== target.id &&
      source.parentSessionId === (target.parentSessionId ?? null) &&
      pinnedSessionIds.has(source.sessionId) === pinnedSessionIds.has(target.id)
    );
  };

  const handleSessionDragOver = (
    event: DragEvent<HTMLDivElement>,
    target: Session,
    workspaceId: string
  ) => {
    if (!canDropSessionOn(target, workspaceId)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({
      type: "session",
      id: target.id,
      placement: getDropPlacement(event),
    });
  };

  const handleSessionDrop = (
    event: DragEvent<HTMLDivElement>,
    target: Session,
    workspaceId: string
  ) => {
    const source = draggedItemRef.current;
    if (!canDropSessionOn(target, workspaceId) || source?.type !== "session") {
      finishSidebarDrag();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    reorderSessions({
      workspaceId,
      draggedSessionId: source.sessionId,
      targetSessionId: target.id,
      placement: getDropPlacement(event),
    });
    finishSidebarDrag();
  };

  const renderSessionRow = (
    session: Session,
    workspaceId: string,
    childrenCollapsed = false
  ) => {
    const status = getSessionStatus(
      session.id,
      currentSessionIdForStatus,
      runningSessions,
      pendingPermissionsBySession,
      pendingAskUserQuestionsBySession
    );
    const isActive =
      isChatView &&
      currentWorkspaceId === workspaceId &&
      currentSessionId === session.id;

    return (
      <SessionRow
        key={session.id}
        session={session}
        workspaceId={workspaceId}
        status={status}
        isActive={isActive}
        isPinned={pinnedSessionIds.has(session.id)}
        onSwitch={handleSwitchSession}
        childCount={groups
          .find((group) => group.workspace.id === workspaceId)
          ?.sessions.filter((item) => item.parentSessionId === session.id).length ?? 0}
        completedChildCount={groups
          .find((group) => group.workspace.id === workspaceId)
          ?.sessions.filter(
            (item) =>
              item.parentSessionId === session.id &&
              item.delegationStatus !== "running"
          ).length ?? 0}
        childrenCollapsed={childrenCollapsed}
        onToggleChildren={
          session.parentSessionId
            ? undefined
            : () => toggleParentChildren(session.id)
        }
        dragEnabled={!isSearchActive}
        isDragging={
          draggedItem?.type === "session" && draggedItem.sessionId === session.id
        }
        dropPlacement={
          dropTarget?.type === "session" && dropTarget.id === session.id
            ? dropTarget.placement
            : null
        }
        onDragStart={(event) =>
          startSidebarDrag(event, {
            type: "session",
            workspaceId,
            sessionId: session.id,
            parentSessionId: session.parentSessionId ?? null,
          })
        }
        onDragOver={(event) => handleSessionDragOver(event, session, workspaceId)}
        onDrop={(event) => handleSessionDrop(event, session, workspaceId)}
        onDragEnd={finishSidebarDrag}
      />
    );
  };

  const renderSessionTreeRows = (sessions: Session[], workspaceId: string) => {
    const visibleIds = new Set(sessions.map((session) => session.id));
    const workspaceSessions =
      groups.find((group) => group.workspace.id === workspaceId)?.sessions ?? sessions;
    const workspaceIds = new Set(workspaceSessions.map((session) => session.id));
    const rows = workspaceSessions
      .filter((session) => !session.parentSessionId)
      .flatMap((parent) => {
        const parentMatches = visibleIds.has(parent.id);
        const children = workspaceSessions
          .filter((child) => child.parentSessionId === parent.id);
        const visibleChildren = normalizedSearchQuery
          ? parentMatches
            ? children
            : children.filter((child) => visibleIds.has(child.id))
          : parentMatches
            ? children
            : [];

        if (!parentMatches && visibleChildren.length === 0) {
          return [];
        }

        const childrenCollapsed =
          !normalizedSearchQuery && collapsedParentSessionIds.has(parent.id);

        return [
          renderSessionRow(parent, workspaceId, childrenCollapsed),
          ...(childrenCollapsed
            ? []
            : visibleChildren.map((child) => renderSessionRow(child, workspaceId))),
        ];
      });
    const orphanRows = sessions
      .filter(
        (session) =>
          session.parentSessionId && !workspaceIds.has(session.parentSessionId)
      )
      .map((session) => renderSessionRow(session, workspaceId));
    return [...rows, ...orphanRows];
  };

  const renderProjectGroup = (group: WorkspaceGroupView) => {
    const workspace = group.workspace;
    const isExpanded = isSearchActive || expandedWorkspaceIds.has(workspace.id);
    const isCurrentWorkspace = isChatView && currentWorkspaceId === workspace.id;
    const showAll = isSearchActive || showAllWorkspaceIds.has(workspace.id);
    const unpinnedSessions = group.sessions.filter(
      (session) => !pinnedSessionIdSet.has(session.id)
    );
    const shownSessions = showAll
      ? unpinnedSessions
      : unpinnedSessions.slice(0, PROJECT_SESSION_PREVIEW_COUNT);
    const hiddenCount = unpinnedSessions.length - shownSessions.length;
    const hasWorkspaceStatus =
      group.status === "running" || group.status === "needs-input";
    const isWorkspaceMenuOpen = workspaceMenuOpenId === workspace.id;
    const isPinnedWorkspace = pinnedWorkspaceIds.has(workspace.id);
    const isRenamingWorkspace = renamingWorkspaceId === workspace.id;
    const canDropWorkspace = () => {
      const source = draggedItemRef.current;
      return (
        source?.type === "workspace" &&
        source.workspaceId !== workspace.id &&
        pinnedWorkspaceIds.has(source.workspaceId) === isPinnedWorkspace
      );
    };

    const shouldShowPathPreview =
      pathPreviewWorkspaceId === workspace.id &&
      Boolean(workspace.path) &&
      !isRenamingWorkspace &&
      !isWorkspaceMenuOpen;

    return (
      <div
        key={workspace.id}
        data-workspace-id={workspace.id}
        draggable={!isSearchActive && !isRenamingWorkspace}
        className={cn(
          "relative space-y-0.5",
          draggedItem?.type === "workspace" &&
            draggedItem.workspaceId === workspace.id &&
            "opacity-45"
        )}
        onDragStart={(event) =>
          startSidebarDrag(event, {
            type: "workspace",
            workspaceId: workspace.id,
          })
        }
        onDragOver={(event) => {
          if (!canDropWorkspace()) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget({
            type: "workspace",
            id: workspace.id,
            placement: getDropPlacement(event),
          });
        }}
        onDrop={(event) => {
          const source = draggedItemRef.current;
          if (!canDropWorkspace() || source?.type !== "workspace") {
            finishSidebarDrag();
            return;
          }
          event.preventDefault();
          reorderWorkspaces({
            draggedWorkspaceId: source.workspaceId,
            targetWorkspaceId: workspace.id,
            placement: getDropPlacement(event),
          });
          finishSidebarDrag();
        }}
        onDragEnd={finishSidebarDrag}
      >
        {dropTarget?.type === "workspace" && dropTarget.id === workspace.id ? (
          <span
            data-testid="workspace-drop-indicator"
            className={cn(
              "pointer-events-none absolute left-1 right-1 z-20 h-0.5 rounded-full bg-[#b87955]",
              dropTarget.placement === "before" ? "-top-[3px]" : "-bottom-[3px]"
            )}
          />
        ) : null}
        <div
          className={cn(
            "group/workspace relative flex h-8 items-center gap-1 rounded-[8px] px-1.5 pr-1 transition-colors",
            shouldShowPathPreview ? "z-[60]" : "z-0",
            isExpanded && !isSearchActive
              ? "bg-white/55 text-stone-900"
              : "text-stone-700 hover:bg-white/50"
          )}
        >
          {isRenamingWorkspace ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1">
              <FolderIcon expanded={isExpanded} />
              <input
                autoFocus
                value={workspaceRenameValue}
                onChange={(event) => setWorkspaceRenameValue(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={() => void handleRenameWorkspaceSubmit(workspace)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleRenameWorkspaceSubmit(workspace);
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    setRenamingWorkspaceId(null);
                    setWorkspaceRenameValue("");
                  }
                }}
                className="h-7 min-w-0 flex-1 rounded-md bg-white px-2 text-sm font-normal text-stone-900 outline-none ring-1 ring-inset ring-stone-200 focus:ring-2 focus:ring-stone-900/10"
              />
            </div>
          ) : (
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10"
              onClick={() => handleToggleWorkspace(workspace.id)}
              aria-expanded={isExpanded}
              aria-current={isCurrentWorkspace ? "location" : undefined}
            >
              <FolderIcon expanded={isExpanded} />
              <span
                onMouseEnter={() => handlePathPreviewEnter(workspace.id)}
                onMouseLeave={handlePathPreviewLeave}
                className="min-w-0 truncate text-sm font-normal leading-4"
              >
                {workspace.name}
              </span>
              {isPinnedWorkspace ? (
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-stone-400"
                  role="img"
                  aria-label="已置顶"
                  title="已置顶"
                >
                  <PinIcon className="h-[15px] w-[15px]" />
                </span>
              ) : null}
            </button>
          )}

          <div
            className="relative h-7 w-[60px] shrink-0"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div
              className={cn(
                "absolute right-0 top-1/2 -translate-y-1/2 transition-opacity",
                isWorkspaceMenuOpen
                  ? "opacity-0"
                  : "opacity-100 group-hover/workspace:opacity-0"
              )}
            >
              {hasWorkspaceStatus ? <WorkspaceBadge status={group.status} /> : null}
            </div>

            <div
              className={cn(
                "absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/workspace:opacity-100",
                isWorkspaceMenuOpen && "opacity-100"
              )}
            >
              <DropdownMenu.Root
                open={isWorkspaceMenuOpen}
                onOpenChange={(open) =>
                  setWorkspaceMenuOpenId(open ? workspace.id : null)
                }
              >
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-400 transition",
                      "hover:bg-stone-900/[0.05] hover:text-stone-700",
                      "focus-visible:opacity-100 focus-visible:outline-none",
                      isWorkspaceMenuOpen &&
                        "bg-white text-stone-800 ring-1 ring-stone-200/70"
                    )}
                    aria-label={`打开${workspace.name}的操作菜单`}
                  >
                    <EllipsisIcon className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenu.Trigger>

                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className={cn(
                      "z-50 w-[132px] overflow-hidden rounded-[10px]",
                      "bg-white/95",
                      "ring-1 ring-stone-200/90 shadow-[0_8px_18px_rgba(41,37,36,0.10)]",
                      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                    )}
                  >
                    <div className="px-0.5 py-0.5">
                      <DropdownMenu.Item
                        className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-stone-700 transition-colors focus:bg-stone-900/[0.04] focus:outline-none data-[highlighted]:bg-stone-900/[0.04]"
                        onSelect={() => togglePinWorkspace(workspace.id)}
                      >
                        <PinIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                        <span>{isPinnedWorkspace ? "取消置顶" : "置顶"}</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-stone-700 transition-colors focus:bg-stone-900/[0.04] focus:outline-none data-[highlighted]:bg-stone-900/[0.04]"
                        onSelect={() => {
                          setWorkspaceRenameValue(workspace.name);
                          setRenamingWorkspaceId(workspace.id);
                        }}
                      >
                        <RenameIcon className="h-3.5 w-3.5 shrink-0 text-stone-500" />
                        <span>重命名</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="mt-0.5 flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-red-700 transition-colors focus:bg-red-50 focus:outline-none data-[highlighted]:bg-red-50"
                        onSelect={() => void handleDeleteWorkspace(workspace)}
                      >
                        <TrashIcon className="h-3.5 w-3.5 shrink-0 text-red-500" />
                        <span>删除</span>
                      </DropdownMenu.Item>
                    </div>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-900/[0.05] hover:text-stone-700 focus-visible:opacity-100 focus-visible:outline-none"
                onClick={() => handleNewChatInWorkspace(workspace.id)}
                aria-label={`在${workspace.name}中新建会话`}
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {shouldShowPathPreview ? (
            <div className="pointer-events-none absolute left-0 right-0 top-full z-[80] mt-1 rounded-[9px] bg-white/95 px-2.5 py-1.5 text-[12px] leading-4 text-stone-700 shadow-[0_8px_22px_rgba(41,37,36,0.12)] ring-1 ring-stone-200/80">
              <span className="block break-all">{workspace.path}</span>
            </div>
          ) : null}
        </div>

        {isExpanded ? (
          <div className="ml-5 space-y-0.5 border-l border-stone-200/70 pb-1 pl-2.5">
            {!group.loaded ? (
              <div className="px-2 py-2 text-[12px] text-stone-400">加载中...</div>
            ) : shownSessions.length === 0 ? (
              <button
                type="button"
                className="w-full rounded-[10px] px-2 py-2 text-left text-[12px] text-stone-400 transition hover:bg-white/40 hover:text-stone-600"
                onClick={() => handleNewChatInWorkspace(workspace.id)}
              >
                暂无会话
              </button>
            ) : (
              renderSessionTreeRows(shownSessions, workspace.id)
            )}

            {hiddenCount > 0 ? (
              <button
                type="button"
                className="w-full rounded-[9px] px-2 py-1.5 text-left text-[12px] text-stone-400 transition hover:bg-white/40 hover:text-stone-600"
                onClick={() => handleToggleShowAll(workspace.id)}
              >
                展开全部
              </button>
            ) : showAllWorkspaceIds.has(workspace.id) &&
              unpinnedSessions.length > PROJECT_SESSION_PREVIEW_COUNT &&
              !isSearchActive ? (
              <button
                type="button"
                className="w-full rounded-[9px] px-2 py-1.5 text-left text-[12px] text-stone-400 transition hover:bg-white/40 hover:text-stone-600"
                onClick={() => handleToggleShowAll(workspace.id)}
              >
                折叠显示
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  if (!defaultGroup && projectGroups.length === 0 && !isSearchActive) {
    return (
      <div className="px-2 py-8 text-center text-[12px] text-stone-400">
        正在读取对话...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {workspaceActionError ? (
        <div className="mx-1 rounded-[9px] bg-red-50/80 px-2.5 py-1.5 text-[12px] leading-4 text-red-600 ring-1 ring-red-100">
          {workspaceActionError}
        </div>
      ) : null}

      {pinnedSessionViews.length > 0 ? (
        <section className="space-y-0.5">
          <SectionHeader
            label="置顶"
            collapsed={arePinnedCollapsed}
            onToggle={() => setPinnedCollapsed((current) => !current)}
          />
          {!arePinnedCollapsed ? (
            <div className="space-y-0.5">
              {pinnedSessionViews.map((item) =>
                item.session.parentSessionId
                  ? renderSessionRow(item.session, item.workspaceId)
                  : renderSessionTreeRows([item.session], item.workspaceId)
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-0.5">
        <SectionHeader
          label="项目"
          collapsed={areProjectsCollapsed}
          onToggle={() => setProjectsCollapsed((current) => !current)}
          actions={
            onCreateProject ? (
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition hover:bg-white/70 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10"
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateProject();
                }}
                aria-label="打开项目"
                title="打开项目"
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </button>
            ) : null
          }
        />
        {!areProjectsCollapsed ? (
          <div className="space-y-0.5">
            {projectGroups.length > 0 ? (
              projectGroups.map(renderProjectGroup)
            ) : (
              <div className="px-2 py-2 text-[12px] text-stone-400">暂无项目</div>
            )}
          </div>
        ) : null}
      </section>

      {defaultGroup ? (
        <section className="space-y-0.5">
          <SectionHeader
            label="对话"
            collapsed={areConversationsCollapsed}
            onToggle={() => setConversationsCollapsed((current) => !current)}
          />
          {!areConversationsCollapsed ? (
            <div className="space-y-0.5">
              {!defaultGroup.loaded ? (
                <div className="px-2 py-2 text-[12px] text-stone-400">加载中...</div>
              ) : defaultSessions.length === 0 ? (
                <button
                  type="button"
                  className="w-full rounded-[10px] px-2 py-2 text-left text-[12px] text-stone-400 transition hover:bg-white/40 hover:text-stone-600"
                  onClick={() => handleNewChatInWorkspace(DEFAULT_WORKSPACE_ID)}
                >
                  暂无会话
                </button>
              ) : (
                renderSessionTreeRows(defaultSessions, DEFAULT_WORKSPACE_ID)
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
