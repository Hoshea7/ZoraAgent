import { useAtom, useSetAtom } from "jotai";
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { runningSessionsAtom } from "../../store/chat";
import {
  groupedSessionsAtom,
  currentSessionIdAtom,
  deleteSessionAtom,
  renameSessionAtom,
  switchSessionAtom
} from "../../store/workspace";
import { cn } from "../../utils/cn";
import { isSettingsOpenAtom } from "../../store/ui";
import type { Session } from "../../types";

/**
 * 会话列表组件
 * 显示按时间分组的会话列表和新建按钮
 */
export function SessionList() {
  const [groupedSessions] = useAtom(groupedSessionsAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const [runningSessions] = useAtom(runningSessionsAtom);
  const switchSession = useSetAtom(switchSessionAtom);
  const deleteSession = useSetAtom(deleteSessionAtom);
  const renameSession = useSetAtom(renameSessionAtom);
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const handleSwitchSession = (sessionId: string) => {
    switchSession(sessionId);
    setSettingsOpen(false);
  };

  const handleRenameSubmit = (sessionId: string, currentTitle: string) => {
    const trimmed = renameValue.trim();

    if (trimmed.length > 0 && trimmed !== currentTitle) {
      renameSession({ sessionId, title: trimmed });
    }

    setRenamingId(null);
    setRenameValue("");
  };

  const handleRenameCancel = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const handleDelete = (sessionId: string, title: string) => {
    setMenuOpenId(null);

    if (window.confirm(`确定删除会话「${title}」？此操作不可撤销。`)) {
      deleteSession(sessionId);
    }
  };

  const renderSession = (session: Session) => (
    <div
      key={session.id}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-[16px] border px-3 py-2.5 transition-all duration-200",
        currentSessionId === session.id
          ? cn(
              "border-stone-200/80 bg-white shadow-[0_2px_10px_rgba(28,25,23,0.05)]"
            )
          : cn(
              "border-transparent bg-transparent",
              "hover:border-stone-200/55 hover:bg-white/50"
            )
      )}
      onMouseEnter={() => setHoveredId(session.id)}
      onMouseLeave={() =>
        setHoveredId((current) => (current === session.id ? null : current))
      }
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (renamingId !== session.id) {
            handleSwitchSession(session.id);
          }
        }}
        onKeyDown={(event) => {
          if (renamingId === session.id) {
            return;
          }

          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleSwitchSession(session.id);
          }
        }}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left",
          "rounded-xl outline-none focus:outline-none focus:ring-0 focus-visible:outline-none"
        )}
      >
        <div className="flex h-4 w-4 items-center justify-center">
          {runningSessions.has(session.id) ? (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400/70 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500"></span>
            </span>
          ) : (
            <div
              className={cn(
                "h-2 w-2 rounded-full border",
                currentSessionId === session.id
                  ? "border-orange-500 bg-orange-500"
                  : "border-stone-300/90 group-hover:border-stone-400/80"
              )}
            ></div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {renamingId === session.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={() => handleRenameSubmit(session.id, session.title)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleRenameSubmit(session.id, session.title);
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  handleRenameCancel();
                }
              }}
              className={cn(
                "w-full rounded-xl bg-white/90 px-2.5 py-1.5 text-sm text-stone-900",
                "ring-1 ring-inset ring-stone-200/80 shadow-[0_1px_0_rgba(255,255,255,0.85)]",
                "outline-none transition placeholder:text-stone-400",
                "hover:ring-stone-300/70 focus:ring-2 focus:ring-stone-900/10"
              )}
            />
          ) : (
            <>
              <div
                className={cn(
                  "truncate text-[14px] leading-[1.3]",
                  currentSessionId === session.id
                    ? "font-medium text-stone-900"
                    : "font-normal text-stone-700 group-hover:text-stone-900"
                )}
              >
                {session.title}
              </div>
              <div className="mt-1 text-[11px] leading-none text-stone-400">
                {new Date(session.createdAt).toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {(hoveredId === session.id || menuOpenId === session.id) &&
        renamingId !== session.id && (
          <div
            className="relative shrink-0"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <DropdownMenu.Root
              open={menuOpenId === session.id}
              onOpenChange={(open) => {
                setMenuOpenId(open ? session.id : null);
              }}
            >
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-lg text-stone-400 opacity-0 transition",
                    "group-hover:opacity-100 hover:bg-stone-900/[0.05] hover:text-stone-700",
                    "focus-visible:outline-none",
                    menuOpenId === session.id &&
                      "bg-white/80 text-stone-800 opacity-100 ring-1 ring-stone-200/70 shadow-sm shadow-stone-900/5"
                  )}
                  aria-label={`打开${session.title}的操作菜单`}
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"
                    />
                  </svg>
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  className={cn(
                    "z-50 w-40 overflow-hidden rounded-2xl",
                    "bg-[#fcfaf7]/90 backdrop-blur-md",
                    "ring-1 ring-stone-200/80 shadow-[0_22px_60px_rgba(41,37,36,0.18)]",
                    "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
                  )}
                >
                  <div className="px-1.5 py-1.5">
                    <DropdownMenu.Item
                      className={cn(
                        "w-full rounded-xl px-3 py-2 text-left text-sm text-stone-700 transition-colors cursor-pointer",
                        "hover:bg-stone-900/[0.04]",
                        "focus:outline-none focus:bg-stone-900/[0.04] data-[highlighted]:bg-stone-900/[0.04]"
                      )}
                      onSelect={(event) => {
                        setRenameValue(session.title);
                        setRenamingId(session.id);
                      }}
                    >
                      重命名
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={cn(
                        "mt-1 w-full rounded-xl px-3 py-2 text-left text-sm text-red-700 transition-colors cursor-pointer",
                        "hover:bg-red-50",
                        "focus:outline-none focus:bg-red-50 data-[highlighted]:bg-red-50"
                      )}
                      onSelect={(event) => {
                        handleDelete(session.id, session.title);
                      }}
                    >
                      删除
                    </DropdownMenu.Item>
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        )}
    </div>
  );

  return (
    <div className="space-y-1.5">
      {/* 置顶会话 */}
      {groupedSessions.pinned.length > 0 && (
        <div className="space-y-1.5">{groupedSessions.pinned.map(renderSession)}</div>
      )}

      {/* 今天的会话 */}
      {groupedSessions.today.length > 0 && (
        <div className="space-y-1.5">{groupedSessions.today.map(renderSession)}</div>
      )}

      {/* 更早的会话 */}
      {groupedSessions.earlier.length > 0 && (
        <div className="space-y-1.5">{groupedSessions.earlier.map(renderSession)}</div>
      )}
    </div>
  );
}
