import { useEffect, useRef, useState } from "react";
import type { ThinkingBlock } from "../../types";
import { formatDuration } from "../../utils/duration";

interface ThinkingStepProps {
  thinking: ThinkingBlock;
  isStreaming: boolean;
}

export function ThinkingStep({ thinking, isStreaming }: ThinkingStepProps) {
  const [userOverride, setUserOverride] = useState<boolean | null>(null);
  const prevStreamingRef = useRef(isStreaming);
  const autoExpanded = isStreaming;
  const isOpen = userOverride !== null ? userOverride : autoExpanded;

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      setUserOverride(null);
    }

    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const duration =
    thinking.startedAt && thinking.completedAt
      ? formatDuration(thinking.completedAt - thinking.startedAt)
      : null;

  const hasContent = thinking.content.trim().length > 0;
  const previewText = hasContent
    ? thinking.content.slice(0, 80).replace(/\n/g, " ")
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
    <div className="group">
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
          <span className="ml-1 min-w-0 flex-1 truncate text-stone-300" title={previewText}>
            {previewText}
          </span>
        ) : (
          <span className="flex-1" />
        )}

        {duration ? (
          <span className="ml-auto flex-shrink-0 text-stone-300">{duration}</span>
        ) : null}
      </button>

      <div
        aria-hidden={!isOpen}
        className={`overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none ${
          isOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <pre className="ml-[18px] mt-1 whitespace-pre-wrap font-sans text-xs leading-relaxed text-stone-400 select-text">
          {thinking.content || ""}
          {isStreaming ? (
            <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse align-text-bottom bg-stone-400 motion-reduce:animate-none" />
          ) : null}
        </pre>
      </div>
    </div>
  );
}
