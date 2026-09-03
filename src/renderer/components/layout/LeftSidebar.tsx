import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_TOGGLE_DURATION_MS,
  activeMainViewAtom,
  clampSidebarWidth,
  closeSettingsAtom,
  isSettingsOpenAtom,
  openSettingsAtom,
  sidebarCollapsedAtom,
  sidebarViewModeAtom,
  sidebarWidthAtom,
  toggleSidebarViewModeAtom,
} from "../../store/ui";
import {
  createWorkspaceAtom,
  DEFAULT_WORKSPACE_ID,
  loadWorkspacesAtom,
  startNewChatInWorkspaceAtom,
} from "../../store/workspace";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import { SessionList } from "../sidebar/SessionList";
import { SidebarFooter } from "../sidebar/SidebarFooter";
import { PlusIcon } from "../ui/Icons";

function SidebarPanelIcon({
  className,
  collapsed,
}: {
  className?: string;
  collapsed?: boolean;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" strokeWidth={2} />
      <path
        d="M9 3v18"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={collapsed ? "M12 8l4 4-4 4" : "M16 8l-4 4 4 4"}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
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
        d="M21 21l-4.35-4.35m1.1-5.15a6.25 6.25 0 11-12.5 0 6.25 6.25 0 0112.5 0z"
      />
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M6.5 10a5.5 5.5 0 0111 0v3.1c0 .95.3 1.87.86 2.63l.64.87H5l.64-.87a4.42 4.42 0 00.86-2.63V10z"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
      <path
        d="M10 19h4"
        strokeLinecap="round"
        strokeWidth={1.8}
      />
    </svg>
  );
}

export function LeftSidebar() {
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const sidebarViewMode = useAtomValue(sidebarViewModeAtom);
  const toggleSidebarViewMode = useSetAtom(toggleSidebarViewModeAtom);
  const activeMainView = useAtomValue(activeMainViewAtom);
  const setActiveMainView = useSetAtom(activeMainViewAtom);
  const isSettingsOpen = useAtomValue(isSettingsOpenAtom);
  const openSettings = useSetAtom(openSettingsAtom);
  const closeSettings = useSetAtom(closeSettingsAtom);
  const loadWorkspaces = useSetAtom(loadWorkspacesAtom);
  const startNewChatInWorkspace = useSetAtom(startNewChatInWorkspaceAtom);
  const createWorkspace = useSetAtom(createWorkspaceAtom);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isPickingWorkspaceDirectory, setIsPickingWorkspaceDirectory] =
    useState(false);
  const [isSubmittingWorkspace, setIsSubmittingWorkspace] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizePreviewWidth, setResizePreviewWidth] = useState<number | null>(
    null
  );
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const resizePreviewWidthRef = useRef<number | null>(null);
  const displayedSidebarWidth = resizePreviewWidth ?? sidebarWidth;
  const collapsedWidthDelta = displayedSidebarWidth - SIDEBAR_COLLAPSED_WIDTH;
  const isScheduleOpen = activeMainView === "schedule";
  const isActivityView = sidebarViewMode === "activity";

  useEffect(() => {
    void loadWorkspaces().catch((error) => {
      setWorkspaceError(getErrorMessage(error));
    });
  }, [loadWorkspaces]);

  useEffect(() => {
    const handleActivityShortcut = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "u"
      ) {
        event.preventDefault();
        toggleSidebarViewMode();
      }
    };

    window.addEventListener("keydown", handleActivityShortcut);
    return () => window.removeEventListener("keydown", handleActivityShortcut);
  }, [toggleSidebarViewMode]);

  useEffect(() => {
    if (isCreateModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isCreateModalOpen]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = clampSidebarWidth(
        resizeStartWidthRef.current + (event.clientX - resizeStartXRef.current)
      );

      resizePreviewWidthRef.current = nextWidth;
      setResizePreviewWidth(nextWidth);
    };

    const handleMouseUp = () => {
      const nextWidth = resizePreviewWidthRef.current;
      setIsResizing(false);
      setResizePreviewWidth(null);
      resizePreviewWidthRef.current = null;

      if (nextWidth !== null) {
        setSidebarWidth(nextWidth);
      }
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, setSidebarWidth]);

  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = sidebarWidth;
    resizePreviewWidthRef.current = sidebarWidth;
    setResizePreviewWidth(sidebarWidth);
    setIsResizing(true);
  };

  const resetWorkspaceForm = () => {
    setWorkspaceName("");
    setWorkspacePath("");
    setWorkspaceError(null);
    setIsCreateModalOpen(false);
  };

  const handleNewChat = () => {
    void startNewChatInWorkspace(DEFAULT_WORKSPACE_ID);
    closeSettings();
  };

  const handlePickWorkspaceDirectory = async () => {
    setIsPickingWorkspaceDirectory(true);
    setWorkspaceError(null);

    try {
      const selectedPath = await window.zora.pickWorkspaceDirectory();
      if (selectedPath) {
        setWorkspacePath(selectedPath);
      }
    } catch (error) {
      setWorkspaceError(getErrorMessage(error));
    } finally {
      setIsPickingWorkspaceDirectory(false);
    }
  };

  const handleCreateWorkspace = async () => {
    const nextName = workspaceName.trim();
    const nextPath = workspacePath.trim();

    if (!nextName || !nextPath) {
      setWorkspaceError("请先填写项目名称并选择目录。");
      return;
    }

    setIsSubmittingWorkspace(true);

    try {
      await createWorkspace({ name: nextName, path: nextPath });
      resetWorkspaceForm();
    } catch (error) {
      setWorkspaceError(getErrorMessage(error));
    } finally {
      setIsSubmittingWorkspace(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "group/sidebar relative z-40 h-full shrink-0 overflow-visible bg-[#f7f6f2]",
        )}
        style={{
          width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : displayedSidebarWidth,
        }}
      >
        <aside
          className={cn(
            "absolute inset-y-0 left-0 flex h-full flex-col overflow-hidden bg-[#f7f6f2] text-stone-900",
            !isResizing &&
              "transition-[clip-path] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          )}
          style={{
            width: displayedSidebarWidth,
            minWidth: displayedSidebarWidth,
            clipPath: collapsed
              ? `inset(0 ${collapsedWidthDelta}px 0 0)`
              : "inset(0 0 0 0)",
            transitionDuration: `${SIDEBAR_TOGGLE_DURATION_MS}ms`,
          }}
        >
          <div
            className={cn(
              "titlebar-drag-region relative shrink-0 bg-transparent",
              collapsed ? "h-[84px]" : "h-10"
            )}
          >
              <div
                className={cn(
                  "titlebar-no-drag absolute right-4 top-[7px] flex items-center gap-1 transition-[opacity,visibility] duration-100 motion-reduce:transition-none",
                  collapsed
                    ? "invisible pointer-events-none opacity-0"
                    : "opacity-100 delay-75",
                )}
                aria-hidden={collapsed}
              >
                <button
                  type="button"
                  onClick={() => toggleSidebarViewMode()}
                  className={cn(
                    "group/activity relative flex h-7 w-7 items-center justify-center rounded-[9px] transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10",
                    isActivityView
                      ? "bg-white/80 text-[#a76342] shadow-sm ring-1 ring-[#d9baa5]"
                      : "text-stone-500 hover:bg-white/55 hover:text-stone-900",
                  )}
                  aria-label={isActivityView ? "关闭活动视图" : "查看活动"}
                  aria-pressed={isActivityView}
                >
                  <ActivityIcon className="h-4 w-4" />
                  <span
                    role="tooltip"
                    className={cn(
                      "pointer-events-none absolute right-0 top-9 z-[90] flex translate-y-1 items-center gap-2 whitespace-nowrap rounded-[9px] bg-stone-900 px-2.5 py-1.5 text-[12px] font-medium text-white opacity-0 shadow-[0_8px_18px_rgba(41,37,36,0.18)] transition duration-150",
                      "group-hover/activity:translate-y-0 group-hover/activity:opacity-100 group-focus-visible/activity:translate-y-0 group-focus-visible/activity:opacity-100",
                    )}
                  >
                    <span>{isActivityView ? "关闭活动视图" : "查看活动"}</span>
                    <kbd className="rounded-[5px] bg-white/10 px-1 py-0.5 font-sans text-[10px] font-normal text-stone-200">
                      ⌥⌘U
                    </kbd>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-[8px] text-stone-500 transition",
                    "hover:bg-white/55 hover:text-stone-900",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10"
                  )}
                  title="折叠侧边栏"
                  aria-label="折叠侧边栏"
                >
                  <SidebarPanelIcon className="h-4 w-4" />
                </button>
              </div>
          </div>

          <div className="titlebar-no-drag relative min-h-0 flex-1">
            <div
              className={cn(
                "absolute inset-0 flex min-h-0 flex-col transition-[opacity,visibility] duration-100 motion-reduce:transition-none",
                collapsed
                  ? "invisible pointer-events-none opacity-0"
                  : "opacity-100 delay-75",
              )}
              aria-hidden={collapsed}
            >
                <div className="space-y-2 px-4 pb-2 pt-0">
                  <button
                    type="button"
                    onClick={handleNewChat}
                    className={cn(
                      "flex min-h-9 w-full min-w-0 items-center justify-center gap-2 rounded-[11px] px-3 py-1.5 text-base font-medium text-stone-800 transition",
                      "bg-white/70 shadow-sm ring-1 ring-stone-200/55",
                      "hover:bg-white hover:text-stone-950 hover:ring-stone-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10"
                    )}
                    title="新建会话"
                  >
                    <PlusIcon className="h-4 w-4 shrink-0 text-stone-500" />
                    <span className="truncate">新会话</span>
                  </button>

                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                    <input
                      type="search"
                      value={sessionSearchQuery}
                      onChange={(event) => setSessionSearchQuery(event.target.value)}
                      placeholder="搜索会话或项目..."
                      className={cn(
                        "h-8 w-full rounded-[10px] border border-transparent bg-white/70 pl-9 pr-3 text-sm text-stone-800 outline-none transition",
                        "placeholder:text-stone-400",
                        "hover:border-stone-200/70 hover:bg-white/65",
                        "focus:border-stone-200 focus:bg-white focus:ring-2 focus:ring-stone-900/10"
                      )}
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
                  <SessionList
                    searchQuery={sessionSearchQuery}
                    viewMode={sidebarViewMode}
                    onCreateProject={() => {
                      setIsCreateModalOpen(true);
                      setWorkspaceError(null);
                    }}
                  />
                </div>

                <div className="mt-auto bg-gradient-to-t from-[#f7f6f2] via-[#f7f6f2] to-transparent px-4 pb-3 pt-3">
                  <SidebarFooter />
                </div>
            </div>

              <div
                className={cn(
                  "absolute inset-y-0 left-0 flex flex-col justify-between px-0 pb-5 pt-0 transition-[opacity,visibility] duration-100 motion-reduce:transition-none",
                  collapsed
                    ? "opacity-100 delay-75"
                    : "invisible pointer-events-none opacity-0",
                )}
                style={{ width: SIDEBAR_COLLAPSED_WIDTH }}
                aria-hidden={!collapsed}
              >
                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleSidebar}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-[13px] text-stone-600",
                      "transition hover:bg-stone-900/[0.05] hover:text-stone-900",
                      "focus-visible:outline-none"
                    )}
                    title="展开侧边栏"
                    aria-label="展开侧边栏"
                  >
                    <SidebarPanelIcon className="h-[18px] w-[18px]" collapsed />
                  </button>

                  <button
                    type="button"
                    onClick={handleNewChat}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-[13px] text-stone-500",
                      "transition hover:bg-stone-900/[0.05] hover:text-stone-900",
                      "focus-visible:outline-none"
                    )}
                    title="新建会话"
                    aria-label="新建会话"
                  >
                    <PlusIcon className="h-[18px] w-[18px]" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setCollapsed(false)}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-[13px] text-stone-400",
                      "transition hover:bg-stone-900/[0.05] hover:text-stone-800",
                      "focus-visible:outline-none"
                    )}
                    title="展开并搜索"
                    aria-label="展开并搜索"
                  >
                    <SearchIcon className="h-[18px] w-[18px]" />
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSidebarViewMode()}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-[13px] transition",
                      isActivityView
                        ? "bg-[#f1e5dc] text-[#a76342] ring-1 ring-[#dec5b3]"
                        : "text-stone-400 hover:bg-stone-900/[0.05] hover:text-stone-800",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10",
                    )}
                    title={isActivityView ? "关闭活动视图" : "查看活动"}
                    aria-label={isActivityView ? "关闭活动视图" : "查看活动"}
                    aria-pressed={isActivityView}
                  >
                    <ActivityIcon className="h-[18px] w-[18px]" />
                  </button>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveMainView("schedule")}
                    className={cn(
                      "mx-auto flex h-10 w-10 items-center justify-center rounded-[14px] transition",
                      isScheduleOpen
                        ? "bg-white/65 text-[#b87955] shadow-sm ring-1 ring-stone-200/60"
                        : "text-stone-400 hover:bg-stone-900/[0.05] hover:text-stone-600"
                    )}
                    title="定时"
                    aria-label="定时"
                    aria-current={isScheduleOpen ? "page" : undefined}
                  >
                    <svg
                      className="h-[18px] w-[18px]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7V3m8 4V3M5 11h14M6 5h12a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2z"
                      />
                    </svg>
                  </button>

                  <button
                    type="button"
                    onClick={() => isSettingsOpen ? closeSettings() : openSettings()}
                    className={cn(
                      "mx-auto flex h-10 w-10 items-center justify-center rounded-[14px] transition",
                      isSettingsOpen
                        ? "bg-white/65 text-[#b87955] shadow-sm ring-1 ring-stone-200/60"
                        : "text-stone-400 hover:bg-stone-900/[0.05] hover:text-stone-600"
                    )}
                    title="设置"
                    aria-label="设置"
                    aria-current={isSettingsOpen ? "page" : undefined}
                  >
                    <svg
                      className="h-[18px] w-[18px]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  </button>
                </div>
              </div>
          </div>

          <div
            aria-hidden="true"
            data-testid="sidebar-visual-edge"
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 z-[70] w-px bg-stone-200/70 shadow-[1px_0_4px_rgba(41,37,36,0.05)]",
              !isResizing &&
                "transition-transform ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            )}
            style={{
              transform: collapsed
                ? `translate3d(-${collapsedWidthDelta}px, 0, 0)`
                : "translate3d(0, 0, 0)",
              transitionDuration: `${SIDEBAR_TOGGLE_DURATION_MS}ms`,
            }}
          />
        </aside>

        {!collapsed ? (
          <div
            className="titlebar-no-drag absolute inset-y-0 right-0 z-50 w-3 translate-x-1/2 cursor-col-resize"
            onMouseDown={handleResizeStart}
            title="拖拽调整侧边栏宽度"
          >
            <div
              className={cn(
                "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full transition-colors duration-150",
                isResizing
                  ? "bg-orange-400/80"
                  : "bg-transparent group-hover/sidebar:bg-stone-300/90"
              )}
            />
          </div>
        ) : null}
      </div>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/20 px-4 transition-opacity">
          <div className="w-full max-w-[360px] overflow-hidden rounded-[16px] bg-[#fffdfb] shadow-[0_24px_70px_rgba(41,37,36,0.20)] ring-1 ring-stone-900/10 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 pb-2 pt-5">
              <h3 className="text-[17px] font-semibold leading-6 text-stone-950">
                新建项目
              </h3>
            </div>

            <div className="space-y-3 px-5 pb-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-stone-700">
                  名称
                </label>
                <input
                  autoFocus
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  placeholder="输入项目名称"
                  className="h-10 w-full rounded-[10px] border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 hover:border-stone-300 focus:border-stone-300 focus:ring-2 focus:ring-stone-900/10"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-stone-700">
                  目录
                </label>
                <button
                  type="button"
                  className="flex h-10 w-full items-center justify-between gap-3 rounded-[10px] border border-stone-200 bg-white px-3 text-left text-sm text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:cursor-wait disabled:opacity-70"
                  onClick={() => void handlePickWorkspaceDirectory()}
                  disabled={isPickingWorkspaceDirectory}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      workspacePath ? "text-stone-900" : "text-stone-400"
                    )}
                  >
                    {workspacePath || "选择文件夹"}
                  </span>
                  <span className="shrink-0 rounded-md bg-stone-100 px-2 py-1 text-[11px] font-medium text-stone-600">
                    {isPickingWorkspaceDirectory ? "打开中" : "浏览"}
                  </span>
                </button>
              </div>

              {workspaceError && (
                <div className="rounded-[10px] border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                  {workspaceError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-stone-100 bg-stone-50/60 px-5 py-3">
              <button
                type="button"
                className="rounded-[9px] px-3.5 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-200/50 hover:text-stone-900 focus:outline-none"
                onClick={resetWorkspaceForm}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-[9px] bg-stone-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900/20 disabled:opacity-50"
                onClick={() => void handleCreateWorkspace()}
                disabled={isSubmittingWorkspace}
              >
                {isSubmittingWorkspace ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
