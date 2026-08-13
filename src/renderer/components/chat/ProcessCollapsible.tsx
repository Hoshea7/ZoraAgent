import { useEffect, useState } from "react";
import type { ProcessStep } from "../../types";
import { cn } from "../../utils/cn";
import { formatDuration } from "../../utils/duration";
import { buildProcessSummary } from "../../utils/toolSummary";
import { ElapsedTimer } from "./ElapsedTimer";
import { ThinkingStep } from "./ThinkingStep";
import { ToolStep } from "./ToolStep";

export function ProcessCollapsible({
  steps,
  isStreaming,
  bodyStarted = false,
  turnStartedAt,
  turnCompletedAt,
}: {
  steps: ProcessStep[];
  isStreaming: boolean;
  bodyStarted?: boolean;
  turnStartedAt: number;
  turnCompletedAt?: number;
}) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [autoExpanded, setAutoExpanded] = useState(() => isStreaming && !bodyStarted);
  const hasRunningTool = steps.some(
    (step) => step.type === "tool" && step.tool.status === "running"
  );
  const expanded = userExpanded ?? autoExpanded;
  const summaryText = buildProcessSummary(steps, isStreaming);
  const activeThinkingId = isStreaming
    ? [...steps]
        .reverse()
        .find(
          (step): step is Extract<ProcessStep, { type: "thinking" }> =>
            step.type === "thinking" && !step.thinking.completedAt
        )?.thinking.id
    : undefined;

  useEffect(() => {
    if (isStreaming && !bodyStarted) {
      setAutoExpanded(true);
      return;
    }

    const settleTimer = window.setTimeout(() => {
      setAutoExpanded(false);
    }, 240);
    return () => window.clearTimeout(settleTimer);
  }, [isStreaming, bodyStarted]);

  return (
    <div className="ai-process-content mb-3 min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() =>
          setUserExpanded((current) => (current === null ? !expanded : !current))
        }
        className="flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-[#7a7168] transition-colors duration-200 hover:bg-stone-50/80 hover:text-[#5f574f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <svg
          className={`h-3 w-3 shrink-0 text-stone-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        <span className="min-w-0 max-w-[560px] truncate text-[13px] animate-trace-summary-in motion-reduce:animate-none">
          {summaryText}
        </span>

        {isStreaming && hasRunningTool ? (
          <span className="relative ml-1 flex h-1.5 w-1.5 items-center justify-center">
            <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-stone-400 opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1 w-1 rounded-full bg-stone-500" />
          </span>
        ) : null}

        {turnCompletedAt ? (
          <span className="shrink-0 pl-2 text-[12px] tabular-nums text-[#b6aea6]">
            {formatDuration(turnCompletedAt - turnStartedAt)}
          </span>
        ) : isStreaming ? (
          <ElapsedTimer
            startedAt={turnStartedAt}
            className="shrink-0 pl-2 text-[12px] text-[#b6aea6]"
          />
        ) : null}
      </button>

      <div
        aria-hidden={!expanded}
        className={cn(
          "ml-1.5 mt-1 min-w-0 border-l-[1.5px] border-stone-200 pl-3 grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="min-h-0 space-y-1 overflow-hidden">
          {steps.map((step) =>
            step.type === "thinking" ? (
              <ThinkingStep
                key={step.thinking.id}
                thinking={step.thinking}
                isStreaming={step.thinking.id === activeThinkingId}
              />
            ) : (
              <ToolStep key={step.tool.id} tool={step.tool} />
            )
          )}
        </div>
      </div>
    </div>
  );
}
