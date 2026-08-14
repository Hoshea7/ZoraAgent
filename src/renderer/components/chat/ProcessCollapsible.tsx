import { useLayoutEffect, useRef, useState } from "react";
import type { ProcessStep } from "../../types";
import { formatDuration } from "../../utils/duration";
import { buildProcessSummary } from "../../utils/toolSummary";
import { ElapsedTimer } from "./ElapsedTimer";
import { ThinkingStep } from "./ThinkingStep";
import { ToolStep } from "./ToolStep";

const INNER_FOLLOW_THRESHOLD_PX = 32;

export function ProcessCollapsible({
  steps,
  isStreaming,
  turnStartedAt,
  turnCompletedAt,
}: {
  steps: ProcessStep[];
  isStreaming: boolean;
  bodyStarted?: boolean;
  turnStartedAt: number;
  turnCompletedAt?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followsLatestRef = useRef(true);
  const summaryText = buildProcessSummary(steps, isStreaming);
  const hasRunningTool = steps.some(
    (step) => step.type === "tool" && step.tool.status === "running"
  );
  const activeThinkingStep = isStreaming
    ? [...steps].reverse().find(
        (step): step is Extract<ProcessStep, { type: "thinking" }> =>
          step.type === "thinking" && !step.thinking.completedAt
      )
    : undefined;
  const activeThinkingId = activeThinkingStep?.thinking.id;

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (expanded && node && followsLatestRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [expanded, steps]);

  return (
    <div className="ai-process-content mb-3 min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-[#7a7168] transition-colors duration-200 hover:bg-stone-50/80 hover:text-[#5f574f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <svg
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 text-stone-400 transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
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
          <ElapsedTimer startedAt={turnStartedAt} className="shrink-0 pl-2 text-[12px] text-[#b6aea6]" />
        ) : null}
      </button>

      {expanded ? (
        <div
          ref={scrollRef}
          onScroll={(event) => {
            const node = event.currentTarget;
            followsLatestRef.current =
              node.scrollHeight - node.scrollTop - node.clientHeight <= INNER_FOLLOW_THRESHOLD_PX;
          }}
          data-agent-activity-scroll="true"
          className="ml-1.5 mt-1 max-h-[min(36vh,320px)] min-w-0 space-y-1 overflow-y-auto overscroll-contain border-l-[1.5px] border-stone-200 pl-3 pr-2 custom-scrollbar"
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
      ) : null}
    </div>
  );
}
