import { useState } from "react";
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
  turnStartedAt,
  turnCompletedAt,
}: {
  steps: ProcessStep[];
  isStreaming: boolean;
  turnStartedAt: number;
  turnCompletedAt?: number;
}) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const hasRunningTool = steps.some(
    (step) => step.type === "tool" && step.tool.status === "running"
  );
  const autoExpanded = isStreaming;
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

  return (
    <div className="mb-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() =>
          setUserExpanded((current) => (current === null ? !expanded : !current))
        }
        className="mx-[-6px] flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-stone-500 transition-colors duration-200 hover:bg-stone-50/80 hover:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <svg
          className={`h-3 w-3 shrink-0 text-stone-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        <span className="min-w-0 flex-1 truncate text-[13px] text-stone-500">
          {summaryText}
        </span>

        {isStreaming && hasRunningTool ? (
          <span className="relative ml-1 flex h-1.5 w-1.5 items-center justify-center">
            <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-stone-400 opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1 w-1 rounded-full bg-stone-500" />
          </span>
        ) : null}

        {turnCompletedAt ? (
          <span className="ml-auto shrink-0 text-[11px] text-stone-300">
            {formatDuration(turnCompletedAt - turnStartedAt)}
          </span>
        ) : isStreaming ? (
          <ElapsedTimer
            startedAt={turnStartedAt}
            className="ml-auto shrink-0 text-[11px] text-stone-300"
          />
        ) : null}
      </button>

      <div
        aria-hidden={!expanded}
        className={cn(
          "ml-1.5 mt-1 border-l-[1.5px] border-stone-200 pl-3 space-y-0.5",
          "overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none",
          expanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        )}
      >
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
  );
}
