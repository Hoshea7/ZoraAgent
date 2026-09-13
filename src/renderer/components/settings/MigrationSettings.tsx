import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy, FolderOpen } from "lucide-react";
import { createMigrationPrompts } from "../../../shared/migration-prompts";
import { getErrorMessage } from "../../utils/message";

type Direction = "archive" | "restore";

export function MigrationSettings() {
  const [directory, setDirectory] = useState("");
  const [direction, setDirection] = useState<Direction>("archive");
  const [copied, setCopied] = useState<Direction | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void window.zora.getMigrationDataDirectory().then((value) => {
      if (!cancelled) setDirectory(value);
    }).catch((cause) => { if (!cancelled) setError(getErrorMessage(cause)); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  const prompts = createMigrationPrompts(directory);
  const isArchive = direction === "archive";
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompts[direction]);
      setCopied(direction);
      setError("");
    } catch (cause) { setError(getErrorMessage(cause)); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-stone-900">数据迁移</h2>
        <p className="mt-2 text-sm leading-6 text-stone-500">将 Zora 的会话、文件和配置带到另一台设备。</p>
      </div>
      <div role="tablist" aria-label="迁移方向" className="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
        {([
          ["archive", "从此设备迁出", ArrowUpFromLine],
          ["restore", "迁入此设备", ArrowDownToLine],
        ] as const).map(([value, label, Icon]) => (
          <button key={value} id={`migration-tab-${value}`} role="tab" aria-selected={direction === value}
            aria-controls="migration-panel" tabIndex={direction === value ? 0 : -1}
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next = event.key === "Home" ? "archive" : event.key === "End" ? "restore" : direction === "archive" ? "restore" : "archive";
                setDirection(next);
                document.getElementById(`migration-tab-${next}`)?.focus();
              }
            }}
            onClick={() => { setDirection(value); setCopied(null); }}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm transition-colors ${direction === value ? "bg-white font-medium text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-900"}`}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>
      <section id="migration-panel" role="tabpanel" aria-labelledby={`migration-tab-${direction}`} className="rounded-2xl border border-stone-200 p-5 sm:p-6">
        <h3 className="font-medium text-stone-900">{isArchive ? "创建迁移压缩包" : "恢复 Zora 数据"}</h3>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          {isArchive ? "任务结束后，将整个数据文件夹压缩为 ZIP，再传到新设备。也可以复制提示词，让 Zora 协助打包。" : "将旧设备的 ZIP 添加到 Zora 对话，再粘贴恢复提示词。Zora 会检查内容，并与你确认覆盖范围和项目目录。"}
        </p>
        <div className="mt-5 flex items-center gap-3 rounded-xl bg-stone-50 px-4 py-3">
          <FolderOpen size={18} className="shrink-0 text-stone-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-stone-500">{isArchive ? "此设备的数据目录" : "恢复到此设备的目录"}</p>
            <p className="mt-1 break-all text-sm text-stone-700">{directory || "读取中…"}</p>
          </div>
          {!isArchive && <button disabled={!directory} aria-label="打开数据文件夹" title="打开数据文件夹"
            className="shrink-0 rounded-lg p-2 text-stone-500 hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-40"
            onClick={() => void window.zora.openMigrationDataDirectory().catch((cause) => setError(getErrorMessage(cause)))}>
            <FolderOpen size={18} />
          </button>}
        </div>
        {isArchive && <button disabled={!directory}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-40"
          onClick={() => void window.zora.openMigrationDataDirectory().catch((cause) => setError(getErrorMessage(cause)))}>
          <FolderOpen size={16} />打开数据文件夹
        </button>}
        <section aria-label={isArchive ? "打包提示词" : "恢复提示词"}
          className="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
          <div className="flex items-center justify-between gap-3 border-b border-stone-200/70 px-4 py-2">
            <h4 className="text-xs font-medium text-stone-500">{isArchive ? "打包提示词" : "恢复提示词"}</h4>
            <button disabled={!directory} onClick={() => void copyPrompt()}
              aria-label={copied === direction ? "已复制" : isArchive ? "复制创建压缩包提示词" : "复制恢复数据提示词"}
              className="inline-flex min-w-20 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-stone-600 hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-40">
              {copied === direction ? <Check size={14} /> : <Copy size={14} />}
              <span aria-live="polite">{copied === direction ? "已复制" : "复制"}</span>
            </button>
          </div>
          <pre className="whitespace-pre-wrap break-words px-4 py-4 font-sans text-sm leading-7 text-stone-600">{directory ? prompts[direction] : "读取中…"}</pre>
        </section>
      </section>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
