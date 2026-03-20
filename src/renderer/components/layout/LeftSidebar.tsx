import { useEffect, useRef, useState } from "react";
import { useAtom, useSetAtom, useAtomValue } from "jotai";
import {
  isSettingsOpenAtom,
  sidebarCollapsedAtom,
  sidebarWidthAtom,
} from "../../store/ui";
import {
  createWorkspaceAtom,
  currentWorkspaceAtom,
  deleteWorkspaceAtom,
  loadWorkspacesAtom,
  startNewChatAtom,
  switchWorkspaceAtom,
  workspacesAtom,
} from "../../store/workspace";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import { SessionList } from "../sidebar/SessionList";
import { SidebarFooter } from "../sidebar/SidebarFooter";

const COLLAPSED_SIDEBAR_WIDTH = 76;
const MIN_SIDEBAR_WIDTH = 292;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH;

export function LeftSidebar() {
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const isSettingsOpen = useAtomValue(isSettingsOpenAtom);
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);
  const [workspaces] = useAtom(workspacesAtom);
  const [currentWorkspace] = useAtom(currentWorkspaceAtom);
  const loadWorkspaces = useSetAtom(loadWorkspacesAtom);
  const startNewChat = useSetAtom(startNewChatAtom);
  const switchWorkspace = useSetAtom(switchWorkspaceAtom);
  const createWorkspace = useSetAtom(createWorkspaceAtom);
  const deleteWorkspace = useSetAtom(deleteWorkspaceAtom);

  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isSubmittingWorkspace, setIsSubmittingWorkspace] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);

  useEffect(() => {
    void loadWorkspaces().catch((error) => {
      setWorkspaceError(getErrorMessage(error));
    });
  }, [loadWorkspaces]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsWorkspaceMenuOpen(false);
        setWorkspaceError(null);
      }
    };

    if (isWorkspaceMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isWorkspaceMenuOpen]);

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
      const nextWidth =
        resizeStartWidthRef.current + (event.clientX - resizeStartXRef.current);

      setSidebarWidth(
        Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, nextWidth))
      );
    };

    const handleMouseUp = () => {
      setIsResizing(false);
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
    setIsWorkspaceMenuOpen(false);
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = sidebarWidth;
    setIsResizing(true);
  };

  const resetWorkspaceForm = () => {
    setWorkspaceName("");
    setWorkspacePath("");
    setWorkspaceError(null);
    setIsCreateModalOpen(false);
  };

  const handleNewChat = () => {
    startNewChat();
    setSettingsOpen(false);
  };

  const handleSwitchWorkspace = async (workspaceId: string) => {
    try {
      await switchWorkspace(workspaceId);
      setIsWorkspaceMenuOpen(false);
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(getErrorMessage(error));
    }
  };

  const handlePickWorkspaceDirectory = async () => {
    try {
      const selectedPath = await window.zora.pickWorkspaceDirectory();
      if (selectedPath) {
        setWorkspacePath(selectedPath);
        setWorkspaceError(null);
      }
    } catch (error) {
      setWorkspaceError(getErrorMessage(error));
    }
  };

  const handleCreateWorkspace = async () => {
    const nextName = workspaceName.trim();
    const nextPath = workspacePath.trim();

    if (!nextName || !nextPath) {
      setWorkspaceError("请先填写工作区名称并选择目录。");
      return;
    }

    setIsSubmittingWorkspace(true);

    try {
      await createWorkspace({ name: nextName, path: nextPath });
      resetWorkspaceForm();
      setIsWorkspaceMenuOpen(false);
    } catch (error) {
      setWorkspaceError(getErrorMessage(error));
    } finally {
      setIsSubmittingWorkspace(false);
    }
  };

  const handleDeleteWorkspace = async (
    workspaceId: string,
    workspaceNameToDelete: string
  ) => {
    if (
      !window.confirm(
        `确定删除工作区「${workspaceNameToDelete}」？该工作区下的本地会话数据也会被移除。`
      )
    ) {
      return;
    }

    try {
      await deleteWorkspace(workspaceId);
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(getErrorMessage(error));
    }
  };

  return (
    <>
      <div
        className={cn(
          "group/sidebar relative z-40 h-full shrink-0",
          !isResizing && "transition-[width] duration-200 ease-out"
        )}
        style={{ width: collapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth }}
      >
        <aside className="relative flex h-full w-full flex-col overflow-hidden border-r border-stone-200/60 bg-[#f7f4ef] text-stone-900 shadow-sm">
          <div
            className={cn(
              "titlebar-drag-region shrink-0 bg-transparent",
              collapsed ? "h-[68px]" : "h-[42px]"
            )}
          />

          <div className="titlebar-no-drag flex min-h-0 flex-1 flex-col">
          {!collapsed ? (
            <>
              <div className="px-4 pb-2 pt-3">
                <div className="flex items-start justify-between gap-3">
                  <div ref={menuRef} className="relative min-w-0 flex-1">
                    <button
                      type="button"
                      className={cn(
                        "group w-full rounded-2xl px-1.5 py-1 text-left",
                        "transition hover:bg-white/45",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10"
                      )}
                      onClick={() => setIsWorkspaceMenuOpen((current) => !current)}
                      aria-haspopup="menu"
                      aria-expanded={isWorkspaceMenuOpen}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[15px] font-semibold tracking-tight text-stone-900">
                              {currentWorkspace?.name ?? "加载工作区..."}
                            </span>
                            {currentWorkspace?.id === "default" && (
                              <span className="rounded-full border border-stone-200/80 bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                                默认
                              </span>
                            )}
                          </div>
                          <div
                            className="mt-1 truncate text-[12.5px] leading-tight text-stone-400"
                            title={currentWorkspace?.path}
                          >
                            {currentWorkspace?.path ?? "正在读取..."}
                          </div>
                        </div>

                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-400 transition group-hover:bg-stone-900/[0.05] group-hover:text-stone-600">
                          <svg
                            className={cn(
                              "h-3.5 w-3.5 transition-transform duration-200",
                              isWorkspaceMenuOpen && "rotate-180"
                            )}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </div>
                      </div>
                    </button>

                    {isWorkspaceMenuOpen && (
                      <div
                        className={cn(
                          "absolute left-0 right-[-12px] top-[calc(100%+6px)] z-50 overflow-hidden",
                          "rounded-2xl bg-white/95 shadow-[0_18px_60px_rgba(28,25,23,0.16)] ring-1 ring-stone-200/70 backdrop-blur-md"
                        )}
                        role="menu"
                      >
                        <div className="border-b border-stone-100 px-3 py-2.5">
                          <div className="text-xs font-semibold text-stone-900">
                            工作区
                          </div>
                          <div className="mt-0.5 text-[11px] text-stone-500">
                            切换将自动加载对应会话列表
                          </div>
                        </div>

                        <div className="max-h-[280px] overflow-y-auto p-1.5">
                          {workspaces.map((workspace) => {
                            const isActive = workspace.id === currentWorkspace?.id;
                            const isDefaultWorkspace = workspace.id === "default";

                            return (
                              <div
                                key={workspace.id}
                                className={cn(
                                  "group relative flex items-center justify-between rounded-lg px-2 py-2 transition",
                                  isActive ? "bg-stone-50" : "hover:bg-stone-100/60"
                                )}
                              >
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none"
                                  onClick={() => void handleSwitchWorkspace(workspace.id)}
                                  aria-current={isActive ? "true" : undefined}
                                >
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        "truncate text-sm",
                                        isActive ? "font-semibold text-stone-900" : "font-medium text-stone-700"
                                      )}
                                    >
                                      {workspace.name}
                                    </span>
                                    {isDefaultWorkspace && (
                                      <span className="rounded bg-stone-200/40 px-1.5 py-0.5 text-[10px] font-medium text-stone-600">
                                        默认
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    className="mt-0.5 truncate text-[11px] text-stone-500"
                                    title={workspace.path}
                                  >
                                    {workspace.path}
                                  </div>
                                </button>

                                <div className="flex shrink-0 items-center gap-1 pl-2">
                                  {isActive && (
                                    <svg
                                      className="h-4 w-4 text-stone-900"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                      aria-hidden="true"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2.5}
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  )}

                                  {!isDefaultWorkspace && (
                                    <button
                                      type="button"
                                      className={cn(
                                        "rounded p-1 text-stone-400 opacity-0 transition",
                                        "group-hover:opacity-100 hover:bg-red-50 hover:text-red-600",
                                        "focus-visible:opacity-100 focus-visible:outline-none"
                                      )}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleDeleteWorkspace(workspace.id, workspace.name);
                                      }}
                                      aria-label={`删除工作区 ${workspace.name}`}
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
                                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8"
                                        />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="border-t border-stone-100 p-1.5">
                          <button
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-stone-700",
                              "transition hover:bg-stone-100/60",
                              "focus-visible:outline-none"
                            )}
                            onClick={() => {
                              setIsWorkspaceMenuOpen(false);
                              setIsCreateModalOpen(true);
                              setWorkspaceError(null);
                            }}
                          >
                            <svg
                              className="h-4 w-4 text-stone-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 4v16m8-8H4"
                              />
                            </svg>
                            新建工作区
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={toggleSidebar}
                    className={cn(
                      "mt-1 shrink-0 rounded-xl p-2 text-stone-400",
                      "transition hover:bg-stone-900/[0.05] hover:text-stone-700",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10"
                    )}
                    title="折叠侧边栏"
                  >
                    <svg
                      className="h-[18px] w-[18px]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <rect width="18" height="18" x="3" y="3" rx="2" strokeWidth={2} />
                      <path
                        d="M9 3v18"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="group flex items-center justify-between px-4 pb-2.5 pt-2">
                <h2 className="text-[14px] font-medium tracking-[0.01em] text-stone-700">
                  会话
                </h2>
                <button
                  onClick={handleNewChat}
                  className={cn(
                    "rounded-lg p-1.5 text-stone-400 transition-colors",
                    "hover:bg-stone-200/50 hover:text-stone-900",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10"
                  )}
                  title="新建会话"
                >
                  <svg
                    className="h-[18px] w-[18px]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-5 pt-1.5">
                <SessionList />
              </div>

              <div className="mt-auto bg-gradient-to-t from-[#f7f4ef] via-[#f7f4ef] to-transparent px-4 pb-4 pt-5">
                <SidebarFooter />
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col justify-between px-0 pb-5 pt-0">
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={toggleSidebar}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-[14px] text-stone-600",
                    "transition hover:bg-stone-900/[0.05] hover:text-stone-900",
                    "focus-visible:outline-none"
                  )}
                  title={`展开侧边栏${
                    currentWorkspace ? `（当前：${currentWorkspace.name}）` : ""
                  }`}
                >
                  <svg
                    className="h-[18px] w-[18px]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <rect width="18" height="18" x="3" y="3" rx="2" strokeWidth={2} />
                    <path
                      d="M9 3v18"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                <button
                  onClick={handleNewChat}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-[14px] text-stone-500",
                    "transition hover:bg-stone-900/[0.05] hover:text-stone-900",
                    "focus-visible:outline-none"
                  )}
                  title="新建会话"
                >
                  <svg
                    className="h-[18px] w-[18px]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>
              </div>

              <button
                onClick={() => setSettingsOpen(!isSettingsOpen)}
                className={cn(
                  "mx-auto flex h-10 w-10 items-center justify-center rounded-[14px] transition",
                  isSettingsOpen
                    ? "text-stone-700"
                    : "text-stone-400 hover:bg-stone-900/[0.05] hover:text-stone-600"
                )}
                title="设置"
              >
                <svg
                  className="h-[18px] w-[18px]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
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
          )}
          </div>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/20 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-[400px] rounded-xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-5 py-4 border-b border-stone-100">
              <h3 className="text-base font-semibold text-stone-900">新建工作区</h3>
              <p className="text-xs text-stone-500 mt-1">创建一个独立的空间以隔离不同项目的会话与配置</p>
            </div>
            
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-stone-700">工作区名称</label>
                <input
                  autoFocus
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="例如：客户端重构"
                  className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-300 focus:ring-4 focus:ring-stone-100"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-stone-700">本地工作目录</label>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-stone-200 bg-white px-3 py-2 text-left text-sm text-stone-700 transition hover:bg-stone-50 focus:outline-none focus:ring-4 focus:ring-stone-100"
                  onClick={() => void handlePickWorkspaceDirectory()}
                >
                  <span className={cn("min-w-0 flex-1 truncate", workspacePath ? "text-stone-900" : "text-stone-400")}>
                    {workspacePath || "选择一个文件夹..."}
                  </span>
                  <span className="shrink-0 rounded bg-stone-100 px-2 py-1 text-[11px] font-medium text-stone-600">
                    浏览
                  </span>
                </button>
              </div>

              {workspaceError && (
                <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 border border-red-100">
                  {workspaceError}
                </div>
              )}
            </div>

            <div className="border-t border-stone-100 bg-stone-50/50 px-5 py-3.5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-200/50 hover:text-stone-900 focus:outline-none"
                onClick={resetWorkspaceForm}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800 focus:outline-none focus:ring-4 focus:ring-stone-900/20 disabled:opacity-50"
                onClick={() => void handleCreateWorkspace()}
                disabled={isSubmittingWorkspace}
              >
                {isSubmittingWorkspace ? "创建中..." : "创建工作区"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
