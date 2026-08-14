import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import { isRunningAtom, messagesAtom } from "../../store/chat";
import { currentSessionIdAtom } from "../../store/workspace";
import type { ConversationMessage } from "../../types";
import { AssistantMessage } from "./AssistantMessage";
import { BouncingDots } from "./BouncingDots";
import { EmptyState } from "./EmptyState";
import { StreamingStatusHint } from "./StreamingStatusHint";
import { UserMessage } from "./UserMessage";

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

function hasStreamingAssistant(messages: ConversationMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      message.turn?.status === "streaming" &&
      !message.turn.error
  );
}

/** Distance from bottom (px) under which we consider the user "at bottom" and resume following. */
const BOTTOM_THRESHOLD_PX = 48;
/** ms window after a user input (wheel/key/touch) during which scroll changes are user-initiated. */
const USER_SCROLL_INTENT_MS = 200;

export function MessageList() {
  const [messages] = useAtom(messagesAtom);
  const [isRunning] = useAtom(isRunningAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const previousSessionIdRef = useRef(currentSessionId);
  const previousMessageCountRef = useRef(messages.length);
  const userScrollIntentRef = useRef(false);
  const userScrollIntentTimerRef = useRef<number>(0);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const lastMessage = messages[messages.length - 1];
  const shouldShowPendingAssistantRow =
    isRunning &&
    lastMessage?.role !== "assistant" &&
    lastMessage?.queueState !== "pending";
  const shouldShowActiveTurnStatus = hasStreamingAssistant(messages);

  // ── Session switch: reset follow state ──────────────────────────────
  // Runs before the scroll effect (layout effects run in definition order).
  useLayoutEffect(() => {
    if (previousSessionIdRef.current === currentSessionId) {
      return;
    }
    previousSessionIdRef.current = currentSessionId;
    isAtBottomRef.current = true;
    userScrollIntentRef.current = false;
    setShowScrollButton(false);
  }, [currentSessionId]);

  // ── New user message: force follow ──────────────────────────────────
  // Runs before the scroll effect so isAtBottomRef is updated before scroll.
  useLayoutEffect(() => {
    const count = messages.length;
    if (count === previousMessageCountRef.current) {
      return;
    }
    previousMessageCountRef.current = count;
    if (count > 0 && messages[count - 1]?.role === "user") {
      isAtBottomRef.current = true;
      setShowScrollButton(false);
    }
  });

  // ── Core: scroll to bottom before paint if following ────────────────
  // No dependency array -> runs after EVERY render (including streaming updates).
  // useLayoutEffect is synchronous before paint, so the user never sees a frame
  // where content grew but scroll didn't catch up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !isAtBottomRef.current) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  });

  // ── User scroll detection ───────────────────────────────────────────
  // wheel/keydown/touchmove set a short "user is scrolling" window.
  // During that window, scroll events are user-initiated and can break/resume follow.
  // Outside that window, scroll events are programmatic (our useLayoutEffect) and ignored.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const markUserScroll = () => {
      userScrollIntentRef.current = true;
      window.clearTimeout(userScrollIntentTimerRef.current);
      userScrollIntentTimerRef.current = window.setTimeout(() => {
        userScrollIntentRef.current = false;
      }, USER_SCROLL_INTENT_MS);
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        // Scrolling up -> immediately break follow (no waiting for scroll event).
        isAtBottomRef.current = false;
        setShowScrollButton(true);
      }
      markUserScroll();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home" ||
        (event.key === " " && event.shiftKey)
      ) {
        isAtBottomRef.current = false;
        setShowScrollButton(true);
        markUserScroll();
      } else if (
        event.key === "ArrowDown" ||
        event.key === "PageDown" ||
        event.key === "End" ||
        (event.key === " " && !event.shiftKey)
      ) {
        markUserScroll();
      }
    };

    const handleTouchStart = () => {
      markUserScroll();
    };

    const handleTouchMove = () => {
      markUserScroll();
    };

    const handleScroll = () => {
      if (!userScrollIntentRef.current) {
        return;
      }
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom < BOTTOM_THRESHOLD_PX) {
        isAtBottomRef.current = true;
        setShowScrollButton(false);
      } else {
        isAtBottomRef.current = false;
        setShowScrollButton(true);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: true });
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("scroll", handleScroll);
      window.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(userScrollIntentTimerRef.current);
    };
  }, []);

  // ── Scroll-to-bottom button ─────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    isAtBottomRef.current = true;
    userScrollIntentRef.current = false;
    setShowScrollButton(false);
    el.scrollTop = el.scrollHeight;
  }, []);

  // ── Render ──────────────────────────────────────────────────────────
  if (messages.length === 0) {
    return (
      <div className="h-full w-full overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-8 custom-scrollbar overscroll-y-none overscroll-x-none">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={scrollRef}
        data-message-scroll-container="true"
        className="h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar overscroll-y-none overscroll-x-none"
      >
        <div className="h-5" />
        {messages.map((message) => (
          <div
            key={message.id}
            className="mx-auto w-full max-w-[920px] px-5 sm:px-8 contain-content"
          >
            {message.role === "user" ? (
              <UserMessage message={message} />
            ) : (
              <AssistantMessage message={message} />
            )}
          </div>
        ))}
        {/* Footer */}
        <div className="px-5 sm:px-8">
          {shouldShowPendingAssistantRow ? <PendingAssistantRow /> : null}
          {shouldShowActiveTurnStatus ? (
            <div
              className="mx-auto w-full max-w-[820px] pt-4"
              data-testid="live-turn-status"
            >
              <StreamingStatusHint label="正在思考" />
            </div>
          ) : null}
          <div className="h-5" />
        </div>
      </div>

      {showScrollButton ? (
        <button
          type="button"
          onClick={scrollToBottom}
          data-testid="scroll-to-bottom"
          className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center justify-center rounded-full border border-stone-200 bg-white p-2 text-stone-500 shadow-md transition-all hover:scale-105 hover:text-stone-900 active:scale-95"
          title="回到底部"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
