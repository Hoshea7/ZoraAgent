import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ThinkingBlock } from "../../types";
import { formatDuration } from "../../utils/duration";
import { normalizeThinkingContent } from "../../utils/thinking";

interface ThinkingStepProps {
  thinking: ThinkingBlock;
  isStreaming: boolean;
}

const EXPAND_SCROLL_PADDING_PX = 24;
const EXPAND_SCROLL_SETTLE_MS = 220;
const THINKING_PREVIEW_CHARS = 120;
const THINKING_SCROLL_FOLLOW_THRESHOLD_PX = 24;

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
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowStreamingRef = useRef(true);
  const shouldRevealAfterToggleRef = useRef(false);
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
      shouldFollowStreamingRef.current = true;
      shouldRevealAfterToggleRef.current = false;
      return;
    }

    if (!shouldRevealAfterToggleRef.current) {
      return;
    }
    shouldRevealAfterToggleRef.current = false;

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

  useEffect(() => {
    shouldFollowStreamingRef.current = true;
  }, [thinking.id]);

  useLayoutEffect(() => {
    const scrollNode = contentScrollRef.current;
    if (!isOpen || !isStreaming || !scrollNode || !shouldFollowStreamingRef.current) {
      return;
    }

    scrollNode.scrollTop = scrollNode.scrollHeight;
  }, [isOpen, isStreaming, normalizedContent]);

  const duration =
    thinking.startedAt && thinking.completedAt
      ? formatDuration(thinking.completedAt - thinking.startedAt)
      : null;

  const hasContent = normalizedContent.trim().length > 0;
  const previewText = hasContent
    ? normalizedContent.slice(0, THINKING_PREVIEW_CHARS).replace(/\s+/g, " ")
    : "正在思考...";

  const handleToggle = () => {
    const nextOpen = !isOpen;
    shouldRevealAfterToggleRef.current = nextOpen;
    setUserOverride(nextOpen);
  };

  const handleContentScroll = () => {
    const scrollNode = contentScrollRef.current;
    if (!scrollNode || !isStreaming) {
      return;
    }

    const distanceFromBottom =
      scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight;
    shouldFollowStreamingRef.current =
      distanceFromBottom <= THINKING_SCROLL_FOLLOW_THRESHOLD_PX;
  };

  return (
    <div ref={stepRef} className="group min-w-0 animate-trace-step-in motion-reduce:animate-none">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={handleToggle}
        className="mx-[-6px] flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11.5px] leading-[18px] text-[#9d958d] transition-colors duration-200 hover:text-[#756d65] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        {isStreaming ? (
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-400 animate-pulse motion-reduce:animate-none" />
        ) : (
          <span className="pt-[1px] text-[9px] text-[#cbc5bf]">●</span>
        )}

        <span className="font-[430]">思考</span>

        {!isOpen ? (
          <span className="ml-1 min-w-0 flex-1 truncate text-[#b6aea6]" title={previewText}>
            {previewText}
          </span>
        ) : null}

        {duration ? (
          <span className="flex-shrink-0 pl-2 text-[11px] tabular-nums text-[#c7c0ba]">{duration}</span>
        ) : null}
      </button>

      <div
        aria-hidden={!isOpen}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            ref={contentScrollRef}
            onScroll={handleContentScroll}
            className="ml-[18px] mt-1 max-h-[min(52vh,460px)] overflow-y-auto overscroll-contain pr-2 custom-scrollbar"
          >
            <pre className="m-0 whitespace-pre-wrap break-words text-[12.5px] leading-[1.56] text-[#7f766e] [overflow-wrap:anywhere] select-text">
              {normalizedContent}
              {isStreaming ? (
                <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse align-text-bottom bg-stone-400 motion-reduce:animate-none" />
              ) : null}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
