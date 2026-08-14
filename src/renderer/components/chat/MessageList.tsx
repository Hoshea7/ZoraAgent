import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useStickToBottom } from "use-stick-to-bottom";
import { isRunningAtom, messagesAtom } from "../../store/chat";
import { currentSessionIdAtom } from "../../store/workspace";
import { AssistantMessage } from "./AssistantMessage";
import { BouncingDots } from "./BouncingDots";
import { EmptyState } from "./EmptyState";
import { UserMessage } from "./UserMessage";
import {
  AGENT_DISCLOSURE_SETTLED_EVENT,
  AGENT_DISCLOSURE_START_EVENT,
  calculateStreamingBodyScrollAdjustment,
} from "../../utils/scrollAnchor";

const sessionDistanceFromBottom = new Map<string, number>();
const QUERY_BOTTOM_RESERVE_MIN_PX = 160;
const QUERY_BOTTOM_RESERVE_MAX_PX = 280;
const QUERY_BOTTOM_RESERVE_RATIO = 0.25;

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

export function MessageList() {
  const messages = useAtomValue(messagesAtom);
  const isRunning = useAtomValue(isRunningAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const hasMessages = messages.length > 0;
  const viewport = useStickToBottom({ initial: "instant", resize: "instant" });
  const previousSessionRef = useRef(currentSessionId);
  const latestSentUserMessage = messages.findLast(
    (message) => message.role === "user" && message.queueState !== "pending"
  );
  const queryAnchorSessionRef = useRef(currentSessionId);
  const previousLatestSentUserMessageIdRef = useRef(latestSentUserMessage?.id);
  const pendingFollowAfterQueryRef = useRef<string | undefined>(undefined);
  const queryAnchorScrollRef = useRef(false);
  const disclosureAnchorRef = useRef(false);
  const streamScrollAdjustmentRef = useRef(false);
  const [isDetached, setIsDetached] = useState(false);

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

  useLayoutEffect(() => {
    const node = viewport.scrollRef.current;
    if (!node) return;

    const handleDisclosureStart = () => {
      disclosureAnchorRef.current = true;
      viewport.stopScroll();
    };
    const handleDisclosureSettled = () => {
      disclosureAnchorRef.current = false;
      setIsDetached(node.scrollHeight - node.scrollTop - node.clientHeight > 48);
    };

    node.addEventListener(AGENT_DISCLOSURE_START_EVENT, handleDisclosureStart);
    node.addEventListener(AGENT_DISCLOSURE_SETTLED_EVENT, handleDisclosureSettled);
    return () => {
      node.removeEventListener(AGENT_DISCLOSURE_START_EVENT, handleDisclosureStart);
      node.removeEventListener(AGENT_DISCLOSURE_SETTLED_EVENT, handleDisclosureSettled);
    };
  }, [viewport]);

  useLayoutEffect(() => {
    const node = viewport.scrollRef.current;
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
    setIsDetached(false);

    const distance = currentSessionId ? sessionDistanceFromBottom.get(currentSessionId) : undefined;
    requestAnimationFrame(() => {
      const currentNode = viewport.scrollRef.current;
      if (!currentNode) {
        return;
      }
      if (distance === undefined || distance <= 48) {
        viewport.scrollToBottom("instant");
      } else {
        viewport.stopScroll();
        currentNode.scrollTop = Math.max(
          0,
          currentNode.scrollHeight - currentNode.clientHeight - distance
        );
      }
    });
  }, [currentSessionId, viewport]);

  useLayoutEffect(() => {
    const nextUserMessageId = latestSentUserMessage?.id;
    if (queryAnchorSessionRef.current !== currentSessionId) {
      queryAnchorSessionRef.current = currentSessionId;
      previousLatestSentUserMessageIdRef.current = nextUserMessageId;
      pendingFollowAfterQueryRef.current = undefined;
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
    const scrollNode = viewport.scrollRef.current;
    const messageNode = viewport.contentRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(latestSentUserMessage.id)}"]`
    );
    if (!scrollNode || !messageNode) {
      return;
    }
    viewport.stopScroll();
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
    requestAnimationFrame(() => {
      queryAnchorScrollRef.current = false;
    });
    pendingFollowAfterQueryRef.current = latestSentUserMessage.id;
  }, [currentSessionId, latestSentUserMessage, messages, viewport]);

  useLayoutEffect(() => {
    if (!pendingFollowAfterQueryRef.current || !activeStreamingAssistant?.turn) {
      return;
    }

    const turn = activeStreamingAssistant.turn;
    const hasStartedOutput =
      turn.processSteps.length > 0 ||
      turn.bodySegments.some((segment) => segment.text.length > 0) ||
      Boolean(turn.error);
    if (!hasStartedOutput) {
      return;
    }

    pendingFollowAfterQueryRef.current = undefined;
    setIsDetached(false);
    viewport.scrollToBottom({ animation: "instant", duration: 80, ignoreEscapes: false });
  }, [activeStreamingAssistant, viewport]);

  useLayoutEffect(() => {
    const node = viewport.scrollRef.current;
    const content = viewport.contentRef.current;
    if (!node || !content || typeof ResizeObserver === "undefined") {
      return;
    }

    const measureStreamingBodyHeight = () =>
      Array.from(
        content.querySelectorAll<HTMLElement>("[data-streaming-assistant-body='true']")
      ).reduce((height, body) => height + body.getBoundingClientRect().height, 0);
    let previousScrollHeight = node.scrollHeight;
    let previousStreamingBodyHeight = measureStreamingBodyHeight();
    const compensateStreamingResize = () => {
      const nextScrollHeight = node.scrollHeight;
      const nextStreamingBodyHeight = measureStreamingBodyHeight();
      const adjustment = calculateStreamingBodyScrollAdjustment(
        nextScrollHeight - previousScrollHeight,
        nextStreamingBodyHeight - previousStreamingBodyHeight
      );
      previousScrollHeight = nextScrollHeight;
      previousStreamingBodyHeight = nextStreamingBodyHeight;
      if (
        adjustment === 0 ||
        !activeStreamingAssistantRef.current ||
        isDetachedRef.current ||
        queryAnchorScrollRef.current ||
        disclosureAnchorRef.current
      ) {
        return;
      }

      streamScrollAdjustmentRef.current = true;
      node.scrollTop = Math.max(0, node.scrollTop + adjustment);
      requestAnimationFrame(() => {
        streamScrollAdjustmentRef.current = false;
      });
    };
    // Streamdown can settle at its final height after the React commit.
    const resizeObserver = new ResizeObserver(compensateStreamingResize);
    resizeObserver.observe(content);
    return () => {
      resizeObserver.disconnect();
    };
  }, [hasMessages, viewport]);

  const scrollToBottom = useCallback(() => {
    setIsDetached(false);
    viewport.scrollToBottom({
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      ignoreEscapes: true,
    });
  }, [viewport]);

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
        ref={viewport.scrollRef}
        data-message-scroll-container="true"
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          if (
            event.target !== event.currentTarget ||
            queryAnchorScrollRef.current ||
            disclosureAnchorRef.current ||
            streamScrollAdjustmentRef.current
          ) {
            return;
          }
          const node = event.currentTarget;
          setIsDetached(node.scrollHeight - node.scrollTop - node.clientHeight > 48);
        }}
        className="h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar overscroll-y-none"
      >
        <div ref={viewport.contentRef} className="min-h-full">
          <div className="h-5" />
          {messages.map((message) => {
            return (
              <div
                key={message.id}
                data-message-id={message.id}
                className={
                  message.role === "assistant"
                    ? "mx-auto w-full max-w-[1280px] px-5 sm:px-8"
                    : "mx-auto w-full max-w-[920px] px-5 sm:px-8"
                }
              >
                {message.role === "user" ? (
                  <UserMessage message={message} />
                ) : (
                  <AssistantMessage message={message} />
                )}
              </div>
            );
          })}
          {showPendingAssistant ? (
            <div className="mx-auto w-full max-w-[920px] px-5 sm:px-8">
              <PendingAssistantRow />
            </div>
          ) : null}
          <div className="h-5" />
        </div>
      </div>

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
