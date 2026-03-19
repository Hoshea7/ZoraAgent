import { useState } from "react";
import type { ThinkingBlock } from "../../types";
import { cn } from "../../utils/cn";
import { formatDuration } from "../../utils/duration";

export function ThinkingStep({
  thinking,
  isStreaming = false,
}: {
  thinking: ThinkingBlock;
  isStreaming?: boolean;
}) {
  if (thinking.content.trim().length === 0) {
    return null;
  }

  const [isOpen, setIsOpen] = useState(false);
  const previewText =
    thinking.content.replace(/\s+/g, " ").trim().slice(0, 80) || "thinking";

  return (
    <div>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="mx-[-6px] flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-200 hover:bg-stone-50/70 hover:text-stone-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-200 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <span className="pt-[3px] text-[9px] text-stone-300">●</span>
        <span
          className={cn(
            "min-w-0 flex-1 text-[12px] text-stone-400",
            isOpen ? "" : "line-clamp-1"
          )}
        >
          {previewText}
        </span>
        {isStreaming ? (
          <span className="relative mt-[5px] flex h-1.5 w-1.5 shrink-0 items-center justify-center">
            <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-stone-400 opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1 w-1 rounded-full bg-stone-500" />
          </span>
        ) : thinking.completedAt ? (
          <span className="shrink-0 text-[11px] text-stone-300">
            {formatDuration(thinking.completedAt - thinking.startedAt)}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div className="ml-5 mt-1 whitespace-pre-wrap text-[12.5px] leading-[1.65] text-stone-500">
          {thinking.content}
        </div>
      ) : null}
    </div>
  );
}
