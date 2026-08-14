import { memo, useState } from "react";
import type { ThinkingBlock } from "../../types";
import { formatDuration } from "../../utils/duration";
import { normalizeThinkingContent } from "../../utils/thinking";
import { captureViewportAnchor } from "../../utils/scrollAnchor";

const THINKING_PREVIEW_CHARS = 120;
export const ThinkingStep = memo(function ThinkingStep({
  thinking,
  isStreaming,
}: {
  thinking: ThinkingBlock;
  isStreaming: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const content = normalizeThinkingContent(thinking.content || "");
  const duration =
    thinking.startedAt && thinking.completedAt
      ? formatDuration(thinking.completedAt - thinking.startedAt)
      : null;
  const previewText = content.trim()
    ? content.slice(0, THINKING_PREVIEW_CHARS).replace(/\s+/g, " ")
    : "正在思考...";

  return (
    <div className="group min-w-0">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={(event) => {
          const restoreAnchor = captureViewportAnchor(event.currentTarget);
          setIsOpen((current) => !current);
          requestAnimationFrame(restoreAnchor);
        }}
        className="flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left text-[11.5px] leading-[18px] text-[#9d958d] transition-colors duration-200 hover:text-[#756d65] focus-visible:text-[#5f574f] focus-visible:underline focus-visible:underline-offset-2 focus-visible:outline-none"
      >
        {isStreaming ? (
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-400 animate-pulse motion-reduce:animate-none" />
        ) : (
          <span className="pt-[1px] text-[9px] leading-none text-[#cbc5bf]">●</span>
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
          data-testid="thinking-detail"
          className="mt-1 min-w-0 max-w-full pl-4"
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
});
