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

const ArrowLeft = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 19-7-7 7-7"/>
    <path d="M19 12H5"/>
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

  // 快捷键：Enter = 允许（仅当反馈框未展开时），Escape = 拒绝/取消
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
    <div className="mb-3 overflow-hidden rounded-2xl bg-white/95 shadow-[0_4px_24px_rgb(0,0,0,0.06)] backdrop-blur-xl transition-all duration-300">
      <div className="p-3 sm:px-4 sm:py-3.5">
        <div className="flex items-start gap-3">
          {/* 盾牌图标 */}
          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600">
            <ShieldAlert />
          </div>

          <div className="min-w-0 flex-1">
            {/* 标题行 */}
            <div className="mb-1 flex items-center gap-2">
              <h3 className="text-[13px] font-semibold text-stone-800">需要 {formattedToolName} 执行权限</h3>
              {remaining > 0 && (
                <span className="rounded bg-stone-200/50 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                  + {remaining}
                </span>
              )}
            </div>

            {/* 操作描述 + 代码块 */}
            <div className="mb-3 space-y-2">
              <p className="text-[13px] leading-snug text-stone-600">{displayDesc}</p>

              {displayCommand && (
                <div className="rounded-lg bg-stone-50 p-2.5">
                  <pre className="max-h-24 overflow-x-auto overflow-y-auto font-mono text-[12px] leading-relaxed text-stone-700 whitespace-pre-wrap break-all">
                    {displayCommand}
                  </pre>
                </div>
              )}
            </div>

            {/* ─── 底部操作栏：状态 1 / 状态 2 共享同一行高度 ─── */}
            {showFeedback ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  type="text"
                  className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-[12px] text-stone-700 placeholder:text-stone-400 outline-none transition-colors focus:border-stone-300 focus:ring-2 focus:ring-stone-200/60"
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
                <button
                  onClick={() => { setShowFeedback(false); setFeedback(""); }}
                  className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
                >
                  <ArrowLeft />
                  返回
                </button>
                <button
                  onClick={() => handleDeny(feedback)}
                  className="shrink-0 rounded-lg bg-stone-800 px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition-all hover:bg-stone-900 active:scale-[0.97]"
                >
                  发送理由
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowFeedback(true)}
                  className="text-[12px] font-medium text-stone-400 transition-colors hover:text-stone-600"
                >
                  提供拒绝理由...
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleAllow(true)}
                    className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-stone-400 transition-colors hover:bg-stone-50 hover:text-stone-600 active:scale-[0.97] whitespace-nowrap"
                  >
                    始终允许
                  </button>
                  <button
                    onClick={() => handleDeny()}
                    className="flex items-center gap-1 rounded-lg bg-stone-200/50 px-3 py-1.5 text-[12px] font-medium text-stone-700 transition-colors hover:bg-stone-200 hover:text-stone-900 active:scale-[0.97]"
                  >
                    <XIcon />
                    拒绝
                  </button>
                  <button
                    onClick={() => handleAllow()}
                    className="flex items-center gap-1 rounded-lg bg-stone-800 px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition-all hover:bg-stone-900 active:scale-[0.97]"
                  >
                    <Check />
                    允许
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
