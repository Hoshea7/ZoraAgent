import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtomValue } from "jotai";
import { useStickToBottom } from "use-stick-to-bottom";
import {
  currentSessionRunIdAtom,
  isRunningAtom,
  messagesAtom,
} from "../../store/chat";
import type { EditIntent } from "../../../shared/zora";
import type { ConversationMessage } from "../../types";
import { currentSessionIdAtom } from "../../store/workspace";
import { AssistantMessage } from "./AssistantMessage";
import { BouncingDots } from "./BouncingDots";
import { EmptyState } from "./EmptyState";
import { UserMessage } from "./UserMessage";
import { ConversationTurnNavigation } from "./ConversationTurnNavigation";
import { getNavigableConversationTurns } from "../../utils/conversation-turn-navigation";
import {
  AGENT_DISCLOSURE_SETTLED_EVENT,
  AGENT_DISCLOSURE_START_EVENT,
  calculateStreamingScrollPlan,
} from "../../utils/scrollAnchor";

const sessionDistanceFromBottom = new Map<string, number>();
const QUERY_BOTTOM_RESERVE_MIN_PX = 160;
const QUERY_BOTTOM_RESERVE_MAX_PX = 280;
const QUERY_BOTTOM_RESERVE_RATIO = 0.25;
const LATEST_CONTENT_THRESHOLD_PX = 4;
const STREAMING_FOLLOW_ANIMATION = {
  damping: 0.78,
  stiffness: 0.08,
  mass: 1.1,
} as const;

function PendingAssistantRow() {
  return (
    <div className="mr-auto mt-8 w-full">
      <div className="mx-auto max-w-[820px] overflow-hidden">
        <div className="mb-2 mt-0.5 flex items-center gap-2">
          <span className="text-[14px] font-semibold tracking-tight text-stone-800">Zora</span>
          <span className="mt-[2px] text-[11px] font-medium text-stone-400">
            {new Date().toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </span>
        </div>
        <BouncingDots />
      </div>
    </div>
  );
}

export interface MessageListProps {
  onReviseMessage?: (
    messageId: string,
    text: string,
    intent: EditIntent,
    observedRunId?: string
  ) => Promise<void>;
}

interface EditingMessage {
  messageId: string;
  intent: EditIntent;
  observedRunId?: string;
}

const MessageRow = memo(function MessageRow({
  message,
  canEdit,
  isRunning,
  editing,
  isNavigationTarget,
  onStartEditing,
  onCancelEditing,
  onResend,
}: {
  message: ConversationMessage;
  canEdit: boolean;
  isRunning: boolean;
  editing: EditingMessage | null;
  isNavigationTarget: boolean;
  onStartEditing: (messageId: string) => void;
  onCancelEditing: () => void;
  onResend: (messageId: string, text: string) => Promise<void>;
}) {
  return (
    <div
      data-message-id={message.id}
      data-streaming-assistant-row={
        message.role === "assistant" && message.turn?.status === "streaming"
          ? "true"
          : undefined
      }
      data-turn-navigation-target={isNavigationTarget ? "true" : undefined}
      className={
        message.role === "assistant"
          ? "mx-auto w-full max-w-[1280px] px-5 sm:px-8"
          : "mx-auto w-full max-w-[920px] px-5 sm:px-8"
      }
    >
      {message.role === "user" ? (
        <UserMessage
          message={message}
          canEdit={canEdit}
          editIntent={
            editing?.intent ??
            (isRunning ? "correct_active_run" : "revise_history")
          }
          isEditing={Boolean(editing)}
          onStartEdit={() => onStartEditing(message.id)}
          onCancelEdit={onCancelEditing}
          onResend={onResend}
        />
      ) : (
        <AssistantMessage message={message} />
      )}
    </div>
  );
});

export function MessageList({ onReviseMessage }: MessageListProps = {}) {
  const messages = useAtomValue(messagesAtom);
  const isRunning = useAtomValue(isRunningAtom);
  const currentRunId = useAtomValue(currentSessionRunIdAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const hasMessages = messages.length > 0;
  const streamingScrollTargetRef = useRef<number | null>(null);
  const streamingFollowSequenceRef = useRef(0);
  const returningToLatestRef = useRef(false);
  const returnToLatestSequenceRef = useRef(0);
  const lastObservedScrollTopRef = useRef<number | null>(null);
  const resolveStreamingScrollTarget = useCallback((targetScrollTop: number) => {
    if (returningToLatestRef.current) {
      return targetScrollTop;
    }
    const streamingTarget = streamingScrollTargetRef.current;
    return streamingTarget === null
      ? targetScrollTop
      : Math.min(targetScrollTop, Math.max(0, streamingTarget));
  }, []);
  const streamingResizeAnimation = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches
    ? "instant"
    : STREAMING_FOLLOW_ANIMATION;
  const {
    scrollRef: viewportScrollRef,
    contentRef: viewportContentRef,
    scrollToBottom: scrollViewportToBottom,
    stopScroll: stopViewportScroll,
  } = useStickToBottom({
    initial: "instant",
    resize: streamingResizeAnimation,
    targetScrollTop: resolveStreamingScrollTarget,
  });
  const previousSessionRef = useRef(currentSessionId);
  const latestSentUserMessage = messages.findLast(
    (message) => message.role === "user" && message.queueState !== "pending"
  );
  const queryAnchorSessionRef = useRef(currentSessionId);
  const previousLatestSentUserMessageIdRef = useRef(latestSentUserMessage?.id);
  const queryAnchorScrollRef = useRef(false);
  const disclosureAnchorRef = useRef(false);
  const disclosureWasDetachedRef = useRef(false);
  const streamScrollAdjustmentRef = useRef(false);
  const [isDetached, setIsDetached] = useState(false);
  const [editing, setEditing] = useState<EditingMessage | null>(null);
  const [navigationTargetId, setNavigationTargetId] = useState<string | null>(null);
  const navigationTargetTimerRef = useRef<number | null>(null);
  const navigationTurns = useMemo(
    () => getNavigableConversationTurns(messages),
    [messages]
  );

  const lastMessage = messages.at(-1);
  const showPendingAssistant =
    isRunning && lastMessage?.role !== "assistant" && lastMessage?.queueState !== "pending";
  const activeStreamingAssistant = messages.findLast(
    (message) => message.role === "assistant" && message.turn?.status === "streaming"
  );
  const activeStreamingAssistantRef = useRef(Boolean(activeStreamingAssistant));
  const isDetachedRef = useRef(isDetached);
  activeStreamingAssistantRef.current = Boolean(activeStreamingAssistant);
  isDetachedRef.current = isDetached;

  useEffect(() => {
    setEditing(null);
    setNavigationTargetId(null);
    if (navigationTargetTimerRef.current !== null) {
      window.clearTimeout(navigationTargetTimerRef.current);
      navigationTargetTimerRef.current = null;
    }
  }, [currentSessionId]);

  useEffect(() => {
    return () => {
      if (navigationTargetTimerRef.current !== null) {
        window.clearTimeout(navigationTargetTimerRef.current);
      }
    };
  }, []);

  const startEditing = useCallback((messageId: string) => {
    setEditing({
      messageId,
      intent: isRunning ? "correct_active_run" : "revise_history",
      observedRunId: isRunning ? currentRunId : undefined,
    });
  }, [currentRunId, isRunning]);

  const cancelEditing = useCallback(() => setEditing(null), []);

  const resendMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!onReviseMessage || editing?.messageId !== messageId) {
        return;
      }
      await onReviseMessage(
        messageId,
        text,
        editing.intent,
        editing.observedRunId
      );
      setEditing((current) =>
        current?.messageId === messageId ? null : current
      );
    },
    [editing, onReviseMessage]
  );

  useLayoutEffect(() => {
    const node = viewportScrollRef.current;
    if (!node) return;

    const handleDisclosureStart = () => {
      disclosureWasDetachedRef.current = isDetachedRef.current;
      disclosureAnchorRef.current = true;
      stopViewportScroll();
    };
    const handleDisclosureSettled = () => {
      disclosureAnchorRef.current = false;
      setIsDetached(
        disclosureWasDetachedRef.current &&
          node.scrollHeight - node.scrollTop - node.clientHeight >
            LATEST_CONTENT_THRESHOLD_PX
      );
    };

    node.addEventListener(AGENT_DISCLOSURE_START_EVENT, handleDisclosureStart);
    node.addEventListener(AGENT_DISCLOSURE_SETTLED_EVENT, handleDisclosureSettled);
    return () => {
      node.removeEventListener(AGENT_DISCLOSURE_START_EVENT, handleDisclosureStart);
      node.removeEventListener(AGENT_DISCLOSURE_SETTLED_EVENT, handleDisclosureSettled);
    };
  }, [stopViewportScroll, viewportScrollRef]);

  useLayoutEffect(() => {
    const node = viewportScrollRef.current;
    if (!node || previousSessionRef.current === currentSessionId) {
      return;
    }

    const previousSessionId = previousSessionRef.current;
    if (previousSessionId) {
      sessionDistanceFromBottom.set(
        previousSessionId,
        Math.max(0, node.scrollHeight - node.scrollTop - node.clientHeight)
      );
    }
    previousSessionRef.current = currentSessionId;
    streamingScrollTargetRef.current = null;
    streamingFollowSequenceRef.current += 1;
    returnToLatestSequenceRef.current += 1;
    returningToLatestRef.current = false;
    lastObservedScrollTopRef.current = null;
    setIsDetached(false);

    const distance = currentSessionId ? sessionDistanceFromBottom.get(currentSessionId) : undefined;
    requestAnimationFrame(() => {
      const currentNode = viewportScrollRef.current;
      if (!currentNode) {
        return;
      }
      if (distance === undefined || distance <= 48) {
        scrollViewportToBottom("instant");
      } else {
        stopViewportScroll();
        currentNode.scrollTop = Math.max(
          0,
          currentNode.scrollHeight - currentNode.clientHeight - distance
        );
      }
    });
  }, [currentSessionId, scrollViewportToBottom, stopViewportScroll, viewportScrollRef]);

  useLayoutEffect(() => {
    const nextUserMessageId = latestSentUserMessage?.id;
    if (queryAnchorSessionRef.current !== currentSessionId) {
      queryAnchorSessionRef.current = currentSessionId;
      previousLatestSentUserMessageIdRef.current = nextUserMessageId;
      return;
    }
    if (
      !latestSentUserMessage ||
      nextUserMessageId === previousLatestSentUserMessageIdRef.current
    ) {
      previousLatestSentUserMessageIdRef.current = nextUserMessageId;
      return;
    }

    previousLatestSentUserMessageIdRef.current = nextUserMessageId;
    const scrollNode = viewportScrollRef.current;
    const messageNode = viewportContentRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(latestSentUserMessage.id)}"]`
    );
    if (!scrollNode || !messageNode) {
      return;
    }
    stopViewportScroll();
    setIsDetached(false);
    queryAnchorScrollRef.current = true;
    const bottomReserve = Math.min(
      QUERY_BOTTOM_RESERVE_MAX_PX,
      Math.max(
        QUERY_BOTTOM_RESERVE_MIN_PX,
        scrollNode.clientHeight * QUERY_BOTTOM_RESERVE_RATIO
      )
    );
    const targetScrollTop =
      messageNode.offsetTop +
      messageNode.offsetHeight -
      (scrollNode.clientHeight - bottomReserve);
    scrollNode.scrollTop = Math.min(
      Math.max(0, targetScrollTop),
      Math.max(0, scrollNode.scrollHeight - scrollNode.clientHeight)
    );
    streamingScrollTargetRef.current = scrollNode.scrollTop;
    requestAnimationFrame(() => {
      queryAnchorScrollRef.current = false;
    });
  }, [
    currentSessionId,
    latestSentUserMessage,
    stopViewportScroll,
    viewportContentRef,
    viewportScrollRef,
  ]);

  useLayoutEffect(() => {
    const node = viewportScrollRef.current;
    const content = viewportContentRef.current;
    if (!node || !content || typeof ResizeObserver === "undefined") {
      return;
    }

    const measureStreamingBodyHeight = () =>
      Array.from(
        content.querySelectorAll<HTMLElement>("[data-streaming-assistant-body='true']")
      ).reduce((height, body) => height + body.getBoundingClientRect().height, 0);
    const measureStreamingProcessHeight = () => {
      const activeRow = content.querySelector<HTMLElement>(
        "[data-streaming-assistant-row='true']"
      );
      return (
        activeRow
          ?.querySelector<HTMLElement>(".ai-process-content")
          ?.getBoundingClientRect().height ?? 0
      );
    };
    let previousScrollHeight = node.scrollHeight;
    let previousStreamingBodyHeight = measureStreamingBodyHeight();
    let previousStreamingProcessHeight = measureStreamingProcessHeight();
    const compensateStreamingResize = () => {
      const nextScrollHeight = node.scrollHeight;
      const nextStreamingBodyHeight = measureStreamingBodyHeight();
      const nextStreamingProcessHeight = measureStreamingProcessHeight();
      const plan = calculateStreamingScrollPlan(
        nextScrollHeight - previousScrollHeight,
        nextStreamingBodyHeight - previousStreamingBodyHeight,
        nextStreamingProcessHeight - previousStreamingProcessHeight
      );
      previousScrollHeight = nextScrollHeight;
      previousStreamingBodyHeight = nextStreamingBodyHeight;
      previousStreamingProcessHeight = nextStreamingProcessHeight;
      if (
        (plan.body === 0 && plan.process === 0) ||
        !activeStreamingAssistantRef.current ||
        isDetachedRef.current ||
        queryAnchorScrollRef.current ||
        disclosureAnchorRef.current
      ) {
        return;
      }

      const maximumScrollTop = Math.max(0, nextScrollHeight - node.clientHeight);
      // Process rows already expand over several frames. Matching each frame's
      // height delta before paint keeps both the body and live status anchored.
      // Body text growth remains spring-followed so new lines enter smoothly.
      const immediateAnchorAdjustment = plan.process;
      const animatedFollowAdjustment = plan.body;

      if (immediateAnchorAdjustment > 0) {
        streamScrollAdjustmentRef.current = true;
        node.scrollTop = Math.min(
          maximumScrollTop,
          Math.max(0, node.scrollTop + immediateAnchorAdjustment)
        );
      }

      if (animatedFollowAdjustment === 0) {
        streamingScrollTargetRef.current = node.scrollTop;
        requestAnimationFrame(() => {
          streamScrollAdjustmentRef.current = false;
        });
        return;
      }

      const previousTarget = streamingScrollTargetRef.current ?? node.scrollTop;
      streamingScrollTargetRef.current = Math.min(
        maximumScrollTop,
        Math.max(
          0,
          Math.max(previousTarget, node.scrollTop) + animatedFollowAdjustment
        )
      );
      const followSequence = streamingFollowSequenceRef.current + 1;
      streamingFollowSequenceRef.current = followSequence;
      streamScrollAdjustmentRef.current = true;
      const followResult = scrollViewportToBottom({
        animation: streamingResizeAnimation,
        ignoreEscapes: false,
        wait: true,
      });
      void Promise.resolve(followResult).then((didFollow) => {
        if (streamingFollowSequenceRef.current !== followSequence) {
          return;
        }
        requestAnimationFrame(() => {
          if (streamingFollowSequenceRef.current === followSequence) {
            streamScrollAdjustmentRef.current = false;
            if (!didFollow) {
              setIsDetached(true);
            }
          }
        });
      });
    };
    // Text mutations arrive before ResizeObserver. Measuring them here keeps the
    // streaming target current before the browser paints another line.
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            compensateStreamingResize();
          });
    mutationObserver?.observe(content, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    // Streamdown can settle at its final height after the React commit.
    const resizeObserver = new ResizeObserver(compensateStreamingResize);
    resizeObserver.observe(content);
    return () => {
      mutationObserver?.disconnect();
      resizeObserver.disconnect();
    };
  }, [
    hasMessages,
    scrollViewportToBottom,
    streamingResizeAnimation,
    viewportContentRef,
    viewportScrollRef,
  ]);

  const scrollToBottom = useCallback(() => {
    streamingScrollTargetRef.current = null;
    streamingFollowSequenceRef.current += 1;
    streamScrollAdjustmentRef.current = false;
    returningToLatestRef.current = true;
    const returnSequence = returnToLatestSequenceRef.current + 1;
    returnToLatestSequenceRef.current = returnSequence;
    setIsDetached(false);
    const result = scrollViewportToBottom({
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      ignoreEscapes: true,
      wait: true,
    });
    void Promise.resolve(result).then(() => {
      if (returnToLatestSequenceRef.current !== returnSequence) return;
      requestAnimationFrame(() => {
        if (returnToLatestSequenceRef.current !== returnSequence) return;
        returningToLatestRef.current = false;
        const node = viewportScrollRef.current;
        if (!node) return;
        lastObservedScrollTopRef.current = node.scrollTop;
        streamingScrollTargetRef.current = node.scrollTop;
        setIsDetached(
          node.scrollHeight - node.scrollTop - node.clientHeight >
            LATEST_CONTENT_THRESHOLD_PX
        );
      });
    });
  }, [scrollViewportToBottom, viewportScrollRef]);

  const navigateToTurn = useCallback(
    (messageId: string) => {
      const scrollNode = viewportScrollRef.current;
      const messageNode = viewportContentRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(messageId)}"]`
      );
      if (!scrollNode || !messageNode) {
        return;
      }

      stopViewportScroll();
      returningToLatestRef.current = false;
      returnToLatestSequenceRef.current += 1;
      streamingFollowSequenceRef.current += 1;
      streamScrollAdjustmentRef.current = false;
      const targetScrollTop = Math.max(0, messageNode.offsetTop - 20);
      streamingScrollTargetRef.current = targetScrollTop;
      scrollNode.scrollTo({
        top: targetScrollTop,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      setIsDetached(
        scrollNode.scrollHeight - targetScrollTop - scrollNode.clientHeight >
          LATEST_CONTENT_THRESHOLD_PX
      );
      setNavigationTargetId(messageId);
      if (navigationTargetTimerRef.current !== null) {
        window.clearTimeout(navigationTargetTimerRef.current);
      }
      navigationTargetTimerRef.current = window.setTimeout(() => {
        setNavigationTargetId((current) => (current === messageId ? null : current));
        navigationTargetTimerRef.current = null;
      }, 1_200);
    },
    [stopViewportScroll, viewportContentRef, viewportScrollRef]
  );

  if (messages.length === 0) {
    return (
      <div className="h-full w-full overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-8 custom-scrollbar overscroll-y-none">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={viewportScrollRef}
        data-message-scroll-container="true"
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          const node = event.currentTarget;
          const previousScrollTop =
            lastObservedScrollTopRef.current ?? node.scrollTop;
          lastObservedScrollTopRef.current = node.scrollTop;
          if (
            queryAnchorScrollRef.current ||
            disclosureAnchorRef.current ||
            returningToLatestRef.current ||
            streamScrollAdjustmentRef.current
          ) {
            return;
          }
          const userScrolledUp = node.scrollTop < previousScrollTop - 0.5;
          const detached =
            userScrolledUp ||
            node.scrollHeight - node.scrollTop - node.clientHeight >
              LATEST_CONTENT_THRESHOLD_PX;
          if (!detached && activeStreamingAssistantRef.current) {
            streamingScrollTargetRef.current = node.scrollTop;
          }
          setIsDetached(detached);
        }}
        className="h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar overscroll-y-none"
      >
        <div ref={viewportContentRef} className="flex min-h-full flex-col">
          <div className="h-5" />
          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              canEdit={Boolean(onReviseMessage)}
              isRunning={isRunning}
              editing={editing?.messageId === message.id ? editing : null}
              isNavigationTarget={navigationTargetId === message.id}
              onStartEditing={startEditing}
              onCancelEditing={cancelEditing}
              onResend={resendMessage}
            />
          ))}
          {showPendingAssistant ? (
            <div className="mx-auto w-full max-w-[920px] px-5 sm:px-8">
              <PendingAssistantRow />
            </div>
          ) : null}
          <div className="h-5" />
        </div>
      </div>

      <ConversationTurnNavigation
        turns={navigationTurns}
        scrollContainerRef={viewportScrollRef}
        contentRef={viewportContentRef}
        onNavigate={navigateToTurn}
      />

      {isDetached ? (
        <button
          type="button"
          onClick={scrollToBottom}
          data-testid="scroll-to-bottom"
          className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center justify-center rounded-full border border-stone-200 bg-white p-2 text-stone-500 shadow-md transition-colors hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
          title="回到底部"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
