import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ProcessStep } from "../../types";
import { formatDuration } from "../../utils/duration";
import { captureViewportAnchor } from "../../utils/scrollAnchor";
import { buildProcessSummary } from "../../utils/toolSummary";
import { AnimatedDisclosure } from "./AnimatedDisclosure";
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
  const [expanded, setExpanded] = useState(() => !bodyStarted);
  const wasStreamingRef = useRef(isStreaming);
  const summaryText = buildProcessSummary(steps, isStreaming);
  const hasRunningTool = steps.some(
    (step) => step.type === "tool" && step.tool.status === "running"
  );
  const activeThinkingStep = isStreaming
    ? steps.findLast(
        (step): step is Extract<ProcessStep, { type: "thinking" }> =>
          step.type === "thinking" && !step.thinking.completedAt
      )
    : undefined;
  const activeThinkingId = activeThinkingStep?.thinking.id;

  useLayoutEffect(() => {
    const completed = wasStreamingRef.current && !isStreaming;
    wasStreamingRef.current = isStreaming;
    if (completed) {
      setExpanded(false);
    }
  }, [isStreaming]);

  return (
    <div className="ai-process-content mb-1.5 min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={(event) => {
          const restoreAnchor = captureViewportAnchor(event.currentTarget);
          flushSync(() => setExpanded((current) => !current));
          restoreAnchor();
        }}
        className="flex w-full min-w-0 items-center gap-2 rounded-sm py-1 text-left text-[#7a7168] hover:text-[#5f574f] focus-visible:text-[#5f574f] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-stone-200/80"
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
        <span className="min-w-0 max-w-[560px] truncate text-[13px]">
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

      <AnimatedDisclosure open={expanded}>
        <div
          data-testid="agent-activity"
          className="ml-1.5 mt-1 min-w-0 border-l border-stone-200/80 pl-3"
        >
          {steps.map((step, index) => {
            const stepId = step.type === "thinking" ? step.thinking.id : step.tool.id;
            return (
              <div
                key={stepId}
                data-testid={`process-step-entry-${stepId}`}
                className={
                  isStreaming
                    ? "grid animate-trace-step-in motion-reduce:animate-none"
                    : "grid"
                }
              >
                <div className="min-h-0 overflow-hidden">
                  <div className={index > 0 ? "pt-1" : undefined}>
                    {step.type === "thinking" ? (
                      <ThinkingStep
                        thinking={step.thinking}
                        isStreaming={step.thinking.id === activeThinkingId}
                      />
                    ) : (
                      <ToolStep tool={step.tool} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </AnimatedDisclosure>
    </div>
  );
}
