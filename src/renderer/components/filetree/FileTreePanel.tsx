import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { FileTreeEntry } from "../../../shared/zora";
import { currentWorkspaceAtom } from "../../store/workspace";
import { fileTreeVersionAtom, fileTreeVisibleAtom } from "../../store/filetree";
import { getErrorMessage } from "../../utils/message";
import { cn } from "../../utils/cn";

/* ------------------------------------------------------------------ */
/*  File extension → color mapping                                     */
/* ------------------------------------------------------------------ */

const EXT_COLORS: Record<string, string> = {
  ts: "text-blue-500", tsx: "text-blue-500",
  js: "text-yellow-500", jsx: "text-yellow-500",
  json: "text-amber-600",
  yml: "text-rose-400", yaml: "text-rose-400",
  css: "text-sky-500", scss: "text-pink-400",
  md: "text-stone-500", txt: "text-stone-400",
  html: "text-orange-500",
  png: "text-emerald-500", jpg: "text-emerald-500", svg: "text-orange-400",
  lock: "text-stone-400",
  pen: "text-violet-400",
  toml: "text-stone-500",
};

function getFileExtension(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return "";
  return name.slice(dotIndex + 1).toLowerCase();
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function FolderIcon({ isOpen }: { isOpen?: boolean }) {
  return (
    <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
      <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {isOpen ? (
          <>
            <path
              d="M5 19h14a2 2 0 002-2V8a2 2 0 00-2-2h-5.17a2 2 0 01-1.42-.59L11 4H5a2 2 0 00-2 2v11a2 2 0 002 2z"
              fill="rgba(201, 120, 73, 0.12)"
              stroke="#c48a4a"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            <path d="M3 13h18" stroke="#c48a4a" strokeWidth={1.2} strokeLinecap="round" opacity={0.35} />
          </>
        ) : (
          <>
            <path
              d="M3.75 7.75a2 2 0 012-2h4.08a2 2 0 011.42.59l1.16 1.16h5.84a2 2 0 012 2v6.75a2 2 0 01-2 2H5.75a2 2 0 01-2-2z"
              fill="rgba(201, 120, 73, 0.12)"
              stroke="#c48a4a"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            <path d="M3.75 10.25h16.5" stroke="#c48a4a" strokeWidth={1.2} strokeLinecap="round" opacity={0.35} />
          </>
        )}
      </svg>
    </div>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = getFileExtension(name);
  const color = EXT_COLORS[ext] ?? "text-stone-350";

  return (
    <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
      <svg
        className={cn("h-[14px] w-[14px]", color)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8.25 3.75h5.9l4.1 4.1v10.4a2 2 0 01-2 2h-8a2 2 0 01-2-2V5.75a2 2 0 012-2z" />
        <path d="M14 3.75v4.25h4.25" />
      </svg>
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={cn(
        "h-3 w-3 shrink-0 text-stone-400 transition-transform duration-150",
        expanded && "rotate-90"
      )}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M9 9h8a2 2 0 012 2v8a2 2 0 01-2 2H9a2 2 0 01-2-2v-8a2 2 0 012-2z"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
      <path
        d="M6 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M5 13l4 4L19 7"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.4}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Recursive tree node                                                */
/* ------------------------------------------------------------------ */

function TreeNode({
  entry,
  depth,
  workspacePath,
  animIndex,
  panelOpen,
}: {
  entry: FileTreeEntry;
  depth: number;
  workspacePath: string;
  animIndex: number;
  panelOpen: boolean;
}) {
  const version = useAtomValue(fileTreeVersionAtom);
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileTreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const lastSeenVersionRef = useRef(version);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const handleToggle = async () => {
    if (!entry.isDirectory) return;
    if (expanded) { setExpanded(false); return; }

    if (children.length === 0) {
      setLoading(true);
      try {
        const result = await window.zora.filetree.list(entry.path, workspacePath);
        setChildren(result);
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  };

  useEffect(() => {
    if (lastSeenVersionRef.current === version) {
      return;
    }

    lastSeenVersionRef.current = version;

    if (!entry.isDirectory || !expanded) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    void window.zora.filetree
      .list(entry.path, workspacePath)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setChildren(result);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setChildren([]);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entry.isDirectory, entry.path, expanded, version, workspacePath]);

  const handleCopyPath = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(entry.path);
      setCopied(true);

      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }

      copyResetTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyResetTimerRef.current = null;
      }, 1500);
    } catch (error) {
      console.error("[filetree] Failed to copy path:", error);
    }
  };

  const pl = 8 + depth * 16;

  return (
    <>
      <div
        className={cn(
          "group/item flex w-full items-center rounded-lg",
          "transition-colors duration-100",
          entry.isDirectory
            ? "text-stone-700 hover:bg-stone-100/60"
            : "text-stone-600 hover:bg-stone-50/80",
          panelOpen && "animate-in fade-in slide-in-from-right-1 duration-200"
        )}
        style={{
          ...(panelOpen ? { animationDelay: `${animIndex * 15}ms`, animationFillMode: "both" } : {}),
        }}
      >
        <button
          type="button"
          onClick={() => void handleToggle()}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 py-[5px] text-left text-[12.5px] leading-tight",
            entry.isDirectory && "font-medium",
            "focus-visible:outline-none"
          )}
          style={{
            paddingLeft: pl,
            paddingRight: 6,
          }}
        >
          {entry.isDirectory ? (
            <>
              <ChevronIcon expanded={expanded} />
              <FolderIcon isOpen={expanded} />
            </>
          ) : (
            <>
              <span className="w-3 shrink-0" />
              <FileIcon name={entry.name} />
            </>
          )}
          <span className="min-w-0 truncate">{entry.name}</span>
        </button>
        <button
          type="button"
          onClick={(event) => void handleCopyPath(event)}
          className={cn(
            "mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-stone-400 transition-all duration-150",
            "focus-visible:opacity-100 focus-visible:outline-none",
            copied
              ? "opacity-100 text-emerald-500"
              : "opacity-0 group-hover/item:opacity-100 hover:text-stone-600"
          )}
          title={copied ? "已复制" : "复制路径"}
          aria-label={copied ? "已复制路径" : "复制路径"}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        {loading && (
          <span className="mr-2 h-3 w-3 shrink-0 animate-spin rounded-full border border-stone-300 border-t-stone-500" />
        )}
      </div>

      {expanded && children.length > 0 && (
        <div>
          {children.map((child, i) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              workspacePath={workspacePath}
              animIndex={i}
              panelOpen={panelOpen}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  FileTreePanel                                                      */
/* ------------------------------------------------------------------ */

export function FileTreePanel({ isOpen }: { isOpen: boolean }) {
  const workspace = useAtomValue(currentWorkspaceAtom);
  const version = useAtomValue(fileTreeVersionAtom);
  const setFileTreeVisible = useSetAtom(fileTreeVisibleAtom);
  const setVersion = useSetAtom(fileTreeVersionAtom);
  const workspacePath = workspace?.path ?? "";
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !workspacePath) {
      return;
    }

    const unsubscribe = window.zora.filetree.onChanged(() => {
      setVersion((current) => current + 1);
    });

    void window.zora.filetree.watch(workspacePath).catch((error) => {
      console.error("[filetree] Failed to start watcher:", error);
    });

    return () => {
      unsubscribe();
      void window.zora.filetree.unwatch().catch((error) => {
        console.error("[filetree] Failed to stop watcher:", error);
      });
    };
  }, [isOpen, setVersion, workspacePath]);

  useEffect(() => {
    let cancelled = false;

    if (!workspacePath) {
      setEntries([]);
      setErrorMessage("当前工作区不可用");
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);
    setErrorMessage(null);

    void window.zora.filetree
      .list(workspacePath, workspacePath)
      .then((nextEntries) => {
        if (cancelled) return;
        setEntries(nextEntries);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setEntries([]);
        setErrorMessage(getErrorMessage(error));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [version, workspacePath]);

  const handleOpenInFinder = async () => {
    if (!workspacePath) return;
    try {
      await window.zora.filetree.openInFinder(workspacePath);
    } catch (error) {
      console.error("[filetree] Failed to open workspace in Finder:", error);
    }
  };

  return (
    <aside
      className={cn(
        "titlebar-no-drag flex h-full shrink-0 flex-col overflow-hidden bg-white",
        "border-l border-stone-200/40",
        "transition-[width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        isOpen ? "w-[280px] opacity-100" : "w-0 opacity-0"
      )}
    >

      {/* Header */}
      <div className="flex min-w-[280px] items-center justify-between border-b border-stone-200/40 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <svg
            className="h-[14px] w-[14px] text-stone-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 7V5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v2" />
            <path d="M3 7h18a1 1 0 011 1v10a2 2 0 01-2 2H4a2 2 0 01-2-2V8a1 1 0 011-1z" />
          </svg>
          <span className="text-[12.5px] font-semibold tracking-tight text-stone-600">
            文件
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void handleOpenInFinder()}
            className={cn(
              "rounded-md px-2 py-1 text-[11px] font-medium text-stone-400 transition-colors",
              "hover:bg-stone-200/40 hover:text-stone-600",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200"
            )}
          >
            在 Finder 中打开
          </button>
          <button
            type="button"
            onClick={() => setFileTreeVisible(false)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition-colors",
              "hover:bg-stone-200/40 hover:text-stone-600",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200"
            )}
            aria-label="关闭文件树"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
            </svg>
          </button>
        </div>
      </div>

      {/* Tree content */}
      <div
        className={cn(
          "custom-scrollbar min-h-0 min-w-[280px] flex-1 overflow-y-auto px-1.5 py-1.5",
          "transition-opacity duration-200 motion-reduce:transition-none",
          isOpen ? "opacity-100" : "opacity-0"
        )}
      >
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-200 border-t-stone-500 motion-reduce:animate-none" />
          </div>
        ) : errorMessage ? (
          <div className="px-4 py-8 text-center">
            <svg className="mx-auto h-7 w-7 text-stone-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <p className="mt-2 text-[11px] text-stone-400">{errorMessage}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <svg className="mx-auto h-7 w-7 text-stone-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7V5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v2" />
              <path d="M3 7h18a1 1 0 011 1v10a2 2 0 01-2 2H4a2 2 0 01-2-2V8a1 1 0 011-1z" />
            </svg>
            <p className="mt-2 text-[11px] text-stone-400">目录为空</p>
          </div>
        ) : (
          <div className="space-y-px">
            {entries.map((entry, index) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                workspacePath={workspacePath}
                animIndex={index}
                panelOpen={isOpen}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
