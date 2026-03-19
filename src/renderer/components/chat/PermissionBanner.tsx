import { useState, useEffect, useCallback } from "react";
import { useAtom, useSetAtom } from "jotai";
import { pendingPermissionsAtom, resolvePermissionAtom } from "../../store/hitl";

// Inline Icons
const ShieldAlert = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
    <path d="M12 8v4"/>
    <path d="M12 16h.01"/>
  </svg>
);

const Code2 = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m18 16 4-4-4-4"/>
    <path d="m6 8-4 4 4 4"/>
    <path d="m14.5 4-5 16"/>
  </svg>
);

const Check = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5"/>
  </svg>
);

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/>
    <path d="m6 6 12 12"/>
  </svg>
);

export function PermissionBanner() {
  const [permissions] = useAtom(pendingPermissionsAtom);
  const resolvePermission = useSetAtom(resolvePermissionAtom);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");

  const current = permissions[0];
  const remaining = permissions.length - 1;

  // 切换到新请求时重置状态
  useEffect(() => {
    setShowFeedback(false);
    setFeedback("");
    console.log("[renderer][permission-banner] Current permission changed.", {
      requestId: current?.requestId ?? null,
      toolName: current?.toolName ?? null,
      queueLength: permissions.length,
    });
  }, [current?.requestId]);

  const handleAllow = useCallback(
    (alwaysAllow = false) => {
      if (!current) return;
      console.log("[renderer][permission-banner] Allow clicked.", {
        requestId: current.requestId,
        toolName: current.toolName,
        alwaysAllow,
      });
      window.zora.respondPermission({
        requestId: current.requestId,
        behavior: "allow",
        alwaysAllow,
      });
      resolvePermission(current.requestId);
    },
    [current, resolvePermission]
  );

  const handleDeny = useCallback(
    (message?: string) => {
      if (!current) return;
      console.log("[renderer][permission-banner] Deny clicked.", {
        requestId: current.requestId,
        toolName: current.toolName,
        hasMessage: Boolean(message?.trim()),
      });
      window.zora.respondPermission({
        requestId: current.requestId,
        behavior: "deny",
        alwaysAllow: false,
        userMessage: message?.trim() || undefined,
      });
      resolvePermission(current.requestId);
      setShowFeedback(false);
      setFeedback("");
    },
    [current, resolvePermission]
  );

  // 快捷键：Enter = 允许（仅当反馈框未展开时），Escape = 拒绝
  useEffect(() => {
    if (!current) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !showFeedback) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "TEXTAREA" && target.tagName !== "INPUT") {
          e.preventDefault();
          handleAllow();
        }
      }
      if (e.key === "Escape") {
        if (showFeedback) {
          setShowFeedback(false);
          setFeedback("");
        } else {
          handleDeny();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current, showFeedback, handleAllow, handleDeny]);

  if (!current) return null;

  const displayCommand = current.command || "";
  const displayDesc = current.description || `使用工具: ${current.toolName}`;
  const cleanToolName = current.toolName.replace("default_api:", "");
  const formattedToolName =
    cleanToolName.charAt(0).toUpperCase() + cleanToolName.slice(1);

  return (
    <div className="mx-4 mb-3 overflow-hidden rounded-2xl border border-stone-200/60 bg-white/95 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl ring-1 ring-black/[0.03] transition-all duration-300">
      {/* 顶部指示条 */}
      <div className="h-1 w-full bg-gradient-to-r from-orange-400 to-amber-400" />
      
      <div className="p-4 sm:p-5">
        {/* 标题行 */}
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 ring-1 ring-orange-100/50">
              <ShieldAlert />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold tracking-tight text-stone-800">请求权限</h3>
                {remaining > 0 && (
                  <span className="flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                    + {remaining} more
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] font-medium text-stone-500">
                {formattedToolName}
              </p>
            </div>
          </div>
        </div>

        {/* 操作描述区 */}
        <div className="mb-5 space-y-3">
          <p className="text-[13.5px] leading-relaxed text-stone-600">{displayDesc}</p>
          
          {displayCommand && (
            <div className="group relative rounded-xl border border-stone-100 bg-stone-50/50 p-3 transition-colors hover:bg-stone-50">
              <div className="mb-1.5 flex items-center gap-1.5">
                <div className="text-stone-400"><Code2 /></div>
                <span className="text-[11px] font-medium uppercase tracking-wider text-stone-400">Command</span>
              </div>
              <pre className="max-h-32 overflow-x-auto overflow-y-auto text-[12.5px] font-mono leading-relaxed text-stone-700 whitespace-pre-wrap word-break-all">
                {displayCommand}
              </pre>
            </div>
          )}
        </div>

        {/* 拒绝理由区域（点击展开） */}
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showFeedback ? 'mb-4 max-h-40 opacity-100' : 'max-h-0 opacity-0'}`}>
          {showFeedback && (
            <>
              <textarea
                autoFocus
                className="w-full resize-none rounded-xl border border-stone-200 bg-stone-50/50 px-3.5 py-3 text-[13px] text-stone-700 placeholder-stone-400 shadow-sm outline-none transition-all focus:border-orange-300 focus:bg-white focus:ring-4 focus:ring-orange-500/10"
                rows={2}
                placeholder="告诉 Zora 你希望怎么调整..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleDeny(feedback);
                  }
                }}
              />
              <div className="mt-2.5 flex items-center justify-end gap-2">
                <button
                  onClick={() => { setShowFeedback(false); setFeedback(""); }}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
                >
                  取消
                </button>
                <button
                  onClick={() => handleDeny(feedback)}
                  className="rounded-lg bg-stone-800 px-4 py-1.5 text-[12px] font-medium text-white shadow-sm transition-all hover:bg-stone-900 hover:shadow active:scale-95"
                >
                  发送拒绝理由
                </button>
              </div>
            </>
          )}
        </div>

        {/* 按钮行 */}
        {!showFeedback && (
          <div className="flex flex-wrap items-center justify-between border-t border-stone-100 pt-4 gap-y-2">
            <button
              onClick={() => setShowFeedback(true)}
              className="group flex items-center gap-1.5 text-[12.5px] font-medium text-stone-500 transition-colors hover:text-stone-800"
            >
              <span>拒绝并说明原因</span>
              <span className="opacity-0 transition-opacity group-hover:opacity-100">...</span>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDeny()}
                className="flex items-center gap-1.5 rounded-xl bg-stone-100 px-3 sm:px-4 py-2 text-[13px] font-semibold text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900 active:scale-95"
              >
                <span className="hidden sm:inline-block"><XIcon /></span>
                拒绝
              </button>
              <button
                onClick={() => handleAllow()}
                className="flex items-center gap-1.5 rounded-xl bg-orange-500 px-3 sm:px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-orange-600 hover:shadow active:scale-95"
              >
                <span className="hidden sm:inline-block"><Check /></span>
                允许
              </button>
              <div className="h-4 w-px bg-stone-200 mx-1" />
              <button
                onClick={() => handleAllow(true)}
                className="rounded-xl px-2 sm:px-3 py-2 text-[12px] font-semibold text-orange-600 transition-colors hover:bg-orange-50 active:scale-95 whitespace-nowrap"
              >
                始终允许
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
