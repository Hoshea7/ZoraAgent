import { useState, useEffect, useCallback } from "react";
import { useAtom, useSetAtom } from "jotai";
import { pendingPermissionsAtom, resolvePermissionAtom } from "../../store/hitl";

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
  }, [current?.requestId]);

  const handleAllow = useCallback(
    (alwaysAllow = false) => {
      if (!current) return;
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
    <div className="mx-4 mb-2 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 shadow-sm">
      {/* 标题行 */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-amber-100">
            <svg className="h-3 w-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 1112 3a9 9 0 017.364 4.636z" />
            </svg>
          </div>
          <span className="text-[13px] font-semibold text-stone-800">{formattedToolName}</span>
          <span className="text-[12px] text-stone-500">请求权限</span>
        </div>
        {remaining > 0 && (
          <span className="rounded-full bg-amber-200/60 px-2 py-0.5 text-[11px] font-medium text-amber-700">+{remaining}</span>
        )}
      </div>

      {/* 操作描述 */}
      <div className="mb-2 rounded-lg bg-white/60 px-3 py-2">
        <p className="text-[13px] leading-relaxed text-stone-700">{displayDesc}</p>
        {displayCommand && (
          <pre className="mt-1 overflow-x-auto text-[12px] font-mono text-stone-600">
            {displayCommand.length > 200 ? displayCommand.slice(0, 200) + "..." : displayCommand}
          </pre>
        )}
      </div>

      {/* 拒绝理由区域（点击展开） */}
      {showFeedback ? (
        <div className="mb-2">
          <textarea
            autoFocus
            className="mb-2 w-full resize-none rounded-lg border border-amber-300 bg-white px-3 py-2 text-[13px] text-stone-700 placeholder-stone-400 outline-none focus:ring-1 focus:ring-amber-200"
            rows={2}
            placeholder="告诉 Zora 你希望怎么做..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleDeny(feedback);
              }
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setShowFeedback(false); setFeedback(""); }}
              className="rounded-lg px-3 py-1.5 text-[12px] text-stone-500 hover:text-stone-700"
            >
              取消
            </button>
            <button
              onClick={() => handleDeny(feedback)}
              className="rounded-lg bg-stone-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-stone-700"
            >
              发送拒绝理由
            </button>
          </div>
        </div>
      ) : (
        /* 按钮行 */
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowFeedback(true)}
            className="text-[12px] text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-stone-700 hover:decoration-stone-500"
          >
            拒绝并说明原因...
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDeny()}
              className="rounded-lg bg-stone-100 px-3 py-1.5 text-[13px] font-medium text-stone-700 hover:bg-stone-200"
            >
              拒绝
            </button>
            <button
              onClick={() => handleAllow()}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-amber-600"
            >
              允许
            </button>
            <button
              onClick={() => handleAllow(true)}
              className="rounded-lg bg-orange-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-orange-600"
            >
              始终允许
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
