import { memo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { BodySegment, ConversationMessage, ProcessStep } from "../../types";
import { CopyButton, MarkdownMessage } from "./MarkdownMessage";
import { ProcessCollapsible } from "./ProcessCollapsible";
import { SegmentDivider } from "./SegmentDivider";
import { BouncingDots } from "./BouncingDots";
import { StreamingStatusHint } from "./StreamingStatusHint";
import {
  findScheduleDetailLinkInActions,
  findScheduleDetailLinkInSteps,
} from "../../utils/scheduleLink";
import { ScheduleTaskLinkButton } from "../schedule/ScheduleTaskLinkButton";
import { ForkIcon } from "../ui/Icons";
import { isRunningAtom } from "../../store/chat";
import {
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  forkSessionAtom,
} from "../../store/workspace";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import { ResponseAnnotationSurface } from "./ResponseAnnotationSurface";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatMessageTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function AssistantForkButton({
  forkPointMessageId,
}: {
  forkPointMessageId: string;
}) {
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom);
  const isRunning = useAtomValue(isRunningAtom);
  const forkSession = useSetAtom(forkSessionAtom);
  const [isForking, setIsForking] = useState(false);
  const forkDisabledReason = isRunning
    ? "会话运行中，结束后再 Fork"
    : !currentSessionId
      ? "当前没有可 Fork 的会话"
      : undefined;
  const tooltipText = forkDisabledReason ?? "Fork 会话";

  const handleFork = async () => {
    if (!currentSessionId || forkDisabledReason || isForking) {
      return;
    }

    setIsForking(true);

    try {
      await forkSession({
        sourceSessionId: currentSessionId,
        workspaceId: currentWorkspaceId,
        upToMessageId: forkPointMessageId,
      });
    } catch (error) {
      window.alert(getErrorMessage(error) || "Fork 会话失败，请稍后再试。");
    } finally {
      setIsForking(false);
    }
  };

  return (
    <span className="group/fork relative inline-flex">
      <button
        type="button"
        onClick={() => void handleFork()}
        disabled={Boolean(forkDisabledReason) || isForking}
        aria-label={tooltipText}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition-colors",
          "hover:bg-stone-200/50 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900/10",
          (forkDisabledReason || isForking) &&
            "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-stone-400"
        )}
      >
        <ForkIcon className={cn("h-3.5 w-3.5", isForking && "animate-pulse")} />
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-stone-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-sm transition-opacity group-hover/fork:opacity-100 group-focus-within/fork:opacity-100">
        {tooltipText}
      </span>
    </span>
  );
}

const AssistantProcessSection = memo(function AssistantProcessSection({
  steps,
  isStreaming,
  bodyStarted,
  turnStartedAt,
  turnCompletedAt,
}: {
  steps: ProcessStep[];
  isStreaming: boolean;
  bodyStarted: boolean;
  turnStartedAt: number;
  turnCompletedAt?: number;
}) {
  return (
    <ProcessCollapsible
      steps={steps}
      isStreaming={isStreaming}
      bodyStarted={bodyStarted}
      turnStartedAt={turnStartedAt}
      turnCompletedAt={turnCompletedAt}
    />
  );
});

const AssistantBodySection = memo(function AssistantBodySection({
  messageId,
  segments,
  isStreaming,
}: {
  messageId: string;
  segments: BodySegment[];
  isStreaming: boolean;
}) {
  const visibleSegments = segments.filter((segment) => segment.text.trim().length > 0);

  const body = (
    <div data-streaming-assistant-body={isStreaming ? "true" : undefined}>
      {visibleSegments.map((segment, index) => (
        <div key={segment.id} className="break-words">
          {index > 0 ? <SegmentDivider /> : null}
          <MarkdownMessage content={segment.text} isStreaming={isStreaming} />
        </div>
      ))}
    </div>
  );

  return isStreaming ? (
    body
  ) : (
    <ResponseAnnotationSurface messageId={messageId}>
      {body}
    </ResponseAnnotationSurface>
  );
});

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
  const hasBody = turn.bodySegments.some((segment) => segment.text.trim().length > 0);
  const copyContent = isStreaming
    ? ""
    : turn.bodySegments
        .filter((segment) => segment.text.trim().length > 0)
        .map((segment) => segment.text)
        .join("\n\n");
  const forkPointMessageId = turn.id;
  const canForkFromMessage = UUID_PATTERN.test(forkPointMessageId);
  const scheduleDetailLink = !isStreaming
    ? findScheduleDetailLinkInActions(turn.actions) ??
      findScheduleDetailLinkInSteps(turn.processSteps)
    : null;

  if (!isStreaming && !hasProcess && !hasBody && !turn.error) {
    return null;
  }

  return (
    <article
      data-assistant-message="true"
      className="group mr-auto mt-8 w-full [container-type:inline-size]"
    >
      <div className="mx-auto max-w-[820px] min-w-0">
        <header className="mb-2 mt-0.5 flex items-center gap-2">
          <span className="text-[14px] font-semibold text-stone-800">Zora</span>
          <span className="mt-[2px] text-[11px] font-medium text-stone-400">
            {formatMessageTime(message.timestamp)}
          </span>
        </header>

        {isStreaming && !hasProcess && !hasBody ? <BouncingDots /> : null}

        {hasProcess ? (
          <AssistantProcessSection
            steps={turn.processSteps}
            isStreaming={isStreaming}
            bodyStarted={hasBody}
            turnStartedAt={turn.startedAt}
            turnCompletedAt={turn.completedAt}
          />
        ) : null}

        {hasBody ? (
          <AssistantBodySection
            messageId={message.id}
            segments={turn.bodySegments}
            isStreaming={isStreaming}
          />
        ) : null}

        {isStreaming && (hasProcess || hasBody) ? (
          <div className="mt-2" data-testid="live-turn-status">
            <StreamingStatusHint label="正在思考" />
          </div>
        ) : null}

        {turn.error ? (
          <div className="chat-message-content mt-3 rounded-xl bg-rose-50/80 px-4 py-3 text-rose-800 ring-1 ring-rose-200/50">
            {turn.error}
          </div>
        ) : null}

        {scheduleDetailLink ? (
          <div className={hasBody || hasProcess ? "mt-3" : "mt-1"}>
            <ScheduleTaskLinkButton link={scheduleDetailLink} />
          </div>
        ) : null}

        {!isStreaming && hasBody ? (
          <div className="mt-3 flex justify-start gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <CopyButton
              content={copyContent}
              className="rounded-md text-stone-400 hover:text-stone-700"
            />
            {canForkFromMessage ? (
              <AssistantForkButton forkPointMessageId={forkPointMessageId} />
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
});
