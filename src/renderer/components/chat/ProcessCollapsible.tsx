import { useLayoutEffect, useRef, useState } from "react";
import type { ProcessStep } from "../../types";
import { formatDuration } from "../../utils/duration";
import { captureViewportAnchor } from "../../utils/scrollAnchor";
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
  const [expanded, setExpanded] = useState(() => !bodyStarted);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const bodyWasStartedRef = useRef(bodyStarted);
  const userControlledRef = useRef(false);
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
    const bodyJustStarted = bodyStarted && !bodyWasStartedRef.current;
    bodyWasStartedRef.current = bodyStarted;

    if (!bodyJustStarted || userControlledRef.current) {
      return;
    }

    const toggle = toggleRef.current;
    const restoreAnchor = toggle ? captureViewportAnchor(toggle) : () => undefined;
    setExpanded(false);
    requestAnimationFrame(restoreAnchor);
  }, [bodyStarted]);

  return (
    <div className="ai-process-content mb-3 min-w-0">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={expanded}
        onClick={(event) => {
          const restoreAnchor = captureViewportAnchor(event.currentTarget);
          userControlledRef.current = true;
          setExpanded((current) => !current);
          requestAnimationFrame(restoreAnchor);
        }}
        className="flex w-full min-w-0 items-center gap-2 py-1 text-left text-[#7a7168] hover:text-[#5f574f] focus-visible:text-[#5f574f] focus-visible:underline focus-visible:underline-offset-2 focus-visible:outline-none"
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

      {expanded ? (
        <div
          data-testid="agent-activity"
          className="ml-1.5 mt-1 min-w-0 space-y-1 border-l border-stone-200/80 pl-3"
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
