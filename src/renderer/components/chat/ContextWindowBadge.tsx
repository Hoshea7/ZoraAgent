import type { ContextWindowState } from "../../../shared/zora";
import { cn } from "../../utils/cn";

export function ContextWindowBadge({ state }: { state?: ContextWindowState }) {
  if (!state || state.contextWindow <= 0) return null;

  const percentage = Math.max(
    0,
    Math.min(100, Math.round((state.usedTokens / state.contextWindow) * 100))
  );
  const compacting = state.status === "compacting";
  const label = compacting ? "正在整理上下文" : `上下文窗口已使用 ${percentage}%`;
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percentage / 100);

  return (
    <div
      className={cn(
        "titlebar-no-drag flex h-8 items-center gap-1.5 rounded-xl px-2 text-[11px]",
        compacting ? "bg-orange-50 text-orange-700" : "text-stone-500 hover:bg-stone-50"
      )}
      aria-label={label}
      title={`${label}，压缩阈值 ${Math.round(
        (state.thresholdTokens / state.contextWindow) * 100
      )}%`}
    >
      <svg className={cn("h-[18px] w-[18px]", compacting && "animate-pulse")} viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
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
      <span>{compacting ? "整理中" : `${percentage}%`}</span>
    </div>
  );
}
