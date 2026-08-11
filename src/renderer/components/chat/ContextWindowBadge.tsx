import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ContextWindowState } from "../../../shared/zora";
import { cn } from "../../utils/cn";

const CONFIRM_RESET_MS = 3_000;

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return tokens.toLocaleString();
}

export interface ContextWindowBadgeProps {
  state?: ContextWindowState;
  canCompact?: boolean;
  isRunning?: boolean;
  onCompact?: () => Promise<void>;
}

export function ContextWindowBadge({
  state,
  canCompact = false,
  isRunning = false,
  onCompact,
}: ContextWindowBadgeProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contextWindow = state?.contextWindow ?? 0;
  const usedTokens = state?.usedTokens ?? 0;
  const hasUsage = contextWindow > 0;
  const percentage = hasUsage
    ? Math.max(0, Math.min(100, Math.round((usedTokens / contextWindow) * 100)))
    : 0;
  const compacting = state?.status === "compacting" || isSubmitting;
  const label = compacting ? "正在压缩上下文" : `上下文窗口已使用 ${percentage}%`;
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percentage / 100);
  const compactDisabled = !canCompact || isRunning || compacting || !hasUsage;

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), CONFIRM_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setConfirming(false);
      setError(null);
    }
  };

  const handleCompact = async () => {
    if (compactDisabled || !onCompact) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }

    setConfirming(false);
    setIsSubmitting(true);
    setError(null);
    try {
      await onCompact();
      setOpen(false);
    } catch (compactError) {
      setError(
        compactError instanceof Error ? compactError.message : "上下文压缩失败"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1 px-0.5 text-[11px] font-medium transition-colors focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300",
            compacting
              ? "text-orange-700"
              : "text-stone-400 hover:text-stone-700"
          )}
          aria-label={label}
          title={label}
        >
          <svg
            className={cn("h-4 w-4", compacting && "animate-spin")}
            viewBox="0 0 18 18"
            aria-hidden="true"
          >
            <circle
              cx="9"
              cy="9"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.18"
              strokeWidth="2"
            />
            <circle
              cx="9"
              cy="9"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 9 9)"
            />
          </svg>
          <span>{compacting ? "压缩中" : `${percentage}%`}</span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="center"
          sideOffset={10}
          collisionPadding={8}
          className="z-50 w-[196px] rounded-[12px] border border-stone-200 bg-white p-2 shadow-[0_14px_38px_rgba(28,25,23,0.14)] animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="space-y-1.5 px-2 py-1 text-[12px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-stone-500">上下文</span>
              <span className="font-medium tabular-nums text-stone-800">
                {formatTokens(usedTokens)} /{" "}
                {hasUsage ? formatTokens(contextWindow) : "--"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-stone-500">占用</span>
              <span className="font-medium tabular-nums text-stone-800">
                {percentage}%
              </span>
            </div>
          </div>

          <div className="my-1 h-px bg-stone-100" />

          <button
            type="button"
            disabled={compactDisabled}
            onClick={() => void handleCompact()}
            className={cn(
              "flex h-8 w-full items-center justify-center gap-2 rounded-lg px-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300",
              confirming
                ? "bg-orange-50 text-orange-700 hover:bg-orange-100"
                : "text-stone-600 hover:bg-stone-50",
              "disabled:cursor-not-allowed disabled:bg-transparent disabled:text-stone-300"
            )}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M8 3v5H3M16 21v-5h5M3 8l5-5M21 16l-5 5M16 3v5h5M8 21v-5H3M21 8l-5-5M3 16l5 5" />
            </svg>
            {isRunning
              ? "对话进行中"
              : compacting
                ? "正在压缩"
                : confirming
                  ? "再次点击确认"
                  : "手动压缩"}
          </button>

          {error ? (
            <p className="mt-2 text-[11px] leading-4 text-rose-500">{error}</p>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
