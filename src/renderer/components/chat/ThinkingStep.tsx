import { useLayoutEffect, useRef, useState } from "react";
import type { ThinkingBlock } from "../../types";
import { formatDuration } from "../../utils/duration";
import { normalizeThinkingContent } from "../../utils/thinking";

const THINKING_PREVIEW_CHARS = 120;
const THINKING_SCROLL_FOLLOW_THRESHOLD_PX = 24;

export function ThinkingStep({
  thinking,
  isStreaming,
}: {
  thinking: ThinkingBlock;
  isStreaming: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowStreamingRef = useRef(true);
  const content = normalizeThinkingContent(thinking.content || "");
  const duration =
    thinking.startedAt && thinking.completedAt
      ? formatDuration(thinking.completedAt - thinking.startedAt)
      : null;
  const previewText = content.trim()
    ? content.slice(0, THINKING_PREVIEW_CHARS).replace(/\s+/g, " ")
    : "正在思考...";

  useLayoutEffect(() => {
    const scrollNode = contentScrollRef.current;
    if (isOpen && isStreaming && scrollNode && shouldFollowStreamingRef.current) {
      scrollNode.scrollTop = scrollNode.scrollHeight;
    }
  }, [content, isOpen, isStreaming]);

  return (
    <div className="group min-w-0 animate-trace-step-in motion-reduce:animate-none">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
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

      {isOpen ? (
        <div
          ref={contentScrollRef}
          onScroll={(event) => {
            const scrollNode = event.currentTarget;
            shouldFollowStreamingRef.current =
              scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight <=
              THINKING_SCROLL_FOLLOW_THRESHOLD_PX;
          }}
          className="ml-[18px] mt-1 max-h-[min(52vh,460px)] min-w-0 max-w-full overflow-y-auto overscroll-contain pr-2 custom-scrollbar"
        >
          <pre className="m-0 max-w-full whitespace-pre-wrap break-words text-[12.5px] leading-[1.56] text-[#7f766e] [overflow-wrap:anywhere] select-text">
            {content}
            {isStreaming ? (
              <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse align-text-bottom bg-stone-400 motion-reduce:animate-none" />
            ) : null}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
