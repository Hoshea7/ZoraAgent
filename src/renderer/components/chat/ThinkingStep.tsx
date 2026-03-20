import { useEffect, useRef, useState } from "react";
import type { ThinkingBlock } from "../../types";
import { formatDuration } from "../../utils/duration";
import { normalizeThinkingContent } from "../../utils/thinking";

interface ThinkingStepProps {
  thinking: ThinkingBlock;
  isStreaming: boolean;
}

const EXPAND_SCROLL_PADDING_PX = 24;
const EXPAND_SCROLL_SETTLE_MS = 220;

function getScrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function revealExpandedStep(stepElement: HTMLDivElement | null) {
  if (!stepElement) {
    return;
  }

  const scrollContainer = stepElement.closest("[data-message-scroll-container='true']");
  if (!(scrollContainer instanceof HTMLElement)) {
    return;
  }

  const stepRect = stepElement.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  const bottomOverflow =
    stepRect.bottom - containerRect.bottom + EXPAND_SCROLL_PADDING_PX;

  if (bottomOverflow > 0) {
    scrollContainer.scrollBy({
      top: bottomOverflow,
      behavior: getScrollBehavior(),
    });
    return;
  }

  const topOverflow = containerRect.top - stepRect.top + 12;
  if (topOverflow > 0) {
    scrollContainer.scrollBy({
      top: -topOverflow,
      behavior: getScrollBehavior(),
    });
  }
}

export function ThinkingStep({ thinking, isStreaming }: ThinkingStepProps) {
  const [userOverride, setUserOverride] = useState<boolean | null>(null);
  const prevStreamingRef = useRef(isStreaming);
  const stepRef = useRef<HTMLDivElement>(null);
  const autoExpanded = isStreaming;
  const isOpen = userOverride !== null ? userOverride : autoExpanded;
  const normalizedContent = normalizeThinkingContent(thinking.content || "");

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      setUserOverride(null);
    }

    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const currentStep = stepRef.current;
    if (!currentStep) {
      return;
    }

    let timeoutId = 0;
    const rafId = requestAnimationFrame(() => {
      revealExpandedStep(currentStep);
      timeoutId = window.setTimeout(() => {
        revealExpandedStep(currentStep);
      }, EXPAND_SCROLL_SETTLE_MS);
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isOpen, thinking.id]);

  const duration =
    thinking.startedAt && thinking.completedAt
      ? formatDuration(thinking.completedAt - thinking.startedAt)
      : null;

  const hasContent = normalizedContent.trim().length > 0;
  const previewText = hasContent
    ? normalizedContent.slice(0, 80).replace(/\n/g, " ")
    : "thinking...";

  const handleToggle = () => {
    setUserOverride((current) => {
      if (current === null) {
        return !autoExpanded;
      }

      return !current;
    });
  };

  return (
    <div ref={stepRef} className="group">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={handleToggle}
        className="mx-[-6px] flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs text-stone-400 transition-colors duration-200 hover:text-stone-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        {isStreaming ? (
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-400 animate-pulse motion-reduce:animate-none" />
        ) : (
          <span className="pt-[1px] text-[9px] text-stone-300">●</span>
        )}

        <span className="font-medium">Thinking</span>

        {!isOpen ? (
          <span className="ml-1 min-w-0 max-w-[460px] truncate text-stone-300" title={previewText}>
            {previewText}
          </span>
        ) : null}

        {duration ? (
          <span className="flex-shrink-0 pl-2 text-stone-300">{duration}</span>
        ) : null}
      </button>

      <div
        aria-hidden={!isOpen}
        className={`overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none ${
          isOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <pre className="ml-[18px] mt-1 whitespace-pre-wrap font-sans text-xs leading-relaxed text-stone-400 select-text">
          {normalizedContent}
          {isStreaming ? (
            <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse align-text-bottom bg-stone-400 motion-reduce:animate-none" />
          ) : null}
        </pre>
      </div>
    </div>
  );
}
