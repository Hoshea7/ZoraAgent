import { memo } from "react";
import type { ConversationMessage } from "../../types";
import { CopyButton, MarkdownMessage } from "./MarkdownMessage";
import { BouncingDots } from "./BouncingDots";
import { ProcessCollapsible } from "./ProcessCollapsible";
import { SegmentDivider } from "./SegmentDivider";
import { ZoraAvatar } from "./UserMessage";

function formatMessageTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
}: {
  message: ConversationMessage;
}) {
  const turn = message.turn;
  if (!turn) {
    return null;
  }

  const isStreaming = turn.status === "streaming";
  const hasProcess = turn.processSteps.length > 0;
  const bodySegments = turn.bodySegments.filter((segment) => segment.text.trim().length > 0);
  const hasBody = bodySegments.length > 0;
  const copyContent = bodySegments.map((segment) => segment.text).join("\n\n");

  return (
    <article className="group mr-auto mt-8 flex w-full max-w-[95%] items-start gap-4">
      <div className="mt-1 flex w-8 shrink-0 justify-center">
        <ZoraAvatar />
      </div>

      <div className="flex-1 overflow-hidden">
        <header className="mb-2 mt-0.5 flex items-center gap-2">
          <span className="text-[14px] font-semibold text-stone-800">Zora</span>
          <span className="mt-[2px] text-[11px] font-medium text-stone-400">
            {formatMessageTime(message.timestamp)}
          </span>
        </header>

        {hasProcess ? (
          <ProcessCollapsible
            steps={turn.processSteps}
            isStreaming={isStreaming}
            turnStartedAt={turn.startedAt}
            turnCompletedAt={turn.completedAt}
          />
        ) : null}

        {hasBody ? (
          <div className="max-w-[680px]">
            {bodySegments.map((segment, index) => (
              <div
                key={segment.id}
                className="break-words text-[15px] leading-[1.7] text-stone-800"
              >
                {index > 0 ? <SegmentDivider /> : null}
                <MarkdownMessage content={segment.text} />
              </div>
            ))}
          </div>
        ) : null}

        {isStreaming && !hasBody && !hasProcess ? <BouncingDots /> : null}

        {turn.error ? (
          <div className="mt-3 rounded-xl bg-rose-50/80 px-4 py-3 text-[14px] leading-relaxed text-rose-800 ring-1 ring-rose-200/50">
            {turn.error}
          </div>
        ) : null}

        {!isStreaming && hasBody ? (
          <div className="mt-3 flex justify-start opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton
              content={copyContent}
              className="h-8 w-8 rounded-md text-stone-400 hover:text-stone-700"
            />
          </div>
        ) : null}
      </div>
    </article>
  );
});
