import { useCallback, useEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { isRunningAtom, messagesAtom } from "../../store/chat";
import { currentSessionIdAtom } from "../../store/workspace";
import { AssistantMessage } from "./AssistantMessage";
import { BouncingDots } from "./BouncingDots";
import { EmptyState } from "./EmptyState";
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

export function MessageList() {
  const [messages] = useAtom(messagesAtom);
  const [isRunning] = useAtom(isRunningAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const previousSessionIdRef = useRef<string | null>(currentSessionId);
  const shouldSnapToBottomRef = useRef(false);
  const userScrolledAwayRef = useRef(false);
  const userReturningToBottomRef = useRef(false);
  const touchYRef = useRef<number | null>(null);
  const pointerActiveRef = useRef(false);
  const previousScrollTopRef = useRef(0);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [hasUserLeftLiveEdge, setHasUserLeftLiveEdge] = useState(false);
  const lastMessage = messages[messages.length - 1];
  const shouldShowPendingAssistantRow =
    isRunning &&
    lastMessage?.role !== "assistant" &&
    lastMessage?.queueState !== "pending";

  useEffect(() => {
    if (previousSessionIdRef.current !== currentSessionId) {
      previousSessionIdRef.current = currentSessionId;
      shouldSnapToBottomRef.current = true;
      userScrolledAwayRef.current = false;
      userReturningToBottomRef.current = false;
      setIsScrolledUp(false);
      setHasUserLeftLiveEdge(false);
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (!scrollContainer || messages.length === 0 || userScrolledAwayRef.current) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      if (!userScrolledAwayRef.current) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [messages, scrollContainer, shouldShowPendingAssistantRow]);

  useEffect(() => {
    if (!scrollContainer) {
      return;
    }

    previousScrollTopRef.current = scrollContainer.scrollTop;

    const leaveBottomFollow = () => {
      userScrolledAwayRef.current = true;
      userReturningToBottomRef.current = false;
      setHasUserLeftLiveEdge(true);
    };
    const returnTowardBottom = () => {
      if (userScrolledAwayRef.current) {
        userReturningToBottomRef.current = true;
      }
    };
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        leaveBottomFollow();
      } else if (event.deltaY > 0) {
        returnTowardBottom();
      }
    };
    const handleTouchStart = (event: TouchEvent) => {
      touchYRef.current = event.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      const previousY = touchYRef.current;
      if (nextY !== undefined && previousY !== null && nextY > previousY) {
        leaveBottomFollow();
      } else if (nextY !== undefined && previousY !== null && nextY < previousY) {
        returnTowardBottom();
      }
      touchYRef.current = nextY ?? null;
    };
    const handleTouchEnd = () => {
      touchYRef.current = null;
    };
    const handlePointerDown = () => {
      pointerActiveRef.current = true;
      previousScrollTopRef.current = scrollContainer.scrollTop;
    };
    const handlePointerUp = () => {
      pointerActiveRef.current = false;
    };
    const handleScroll = () => {
      const nextScrollTop = scrollContainer.scrollTop;
      if (pointerActiveRef.current && nextScrollTop < previousScrollTopRef.current) {
        leaveBottomFollow();
      } else if (
        pointerActiveRef.current &&
        nextScrollTop > previousScrollTopRef.current
      ) {
        returnTowardBottom();
      }
      previousScrollTopRef.current = nextScrollTop;
    };

    scrollContainer.addEventListener("wheel", handleWheel, { passive: true });
    scrollContainer.addEventListener("touchstart", handleTouchStart, { passive: true });
    scrollContainer.addEventListener("touchmove", handleTouchMove, { passive: true });
    scrollContainer.addEventListener("touchend", handleTouchEnd, { passive: true });
    scrollContainer.addEventListener("pointerdown", handlePointerDown, { passive: true });
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    window.addEventListener("pointercancel", handlePointerUp, { passive: true });

    return () => {
      scrollContainer.removeEventListener("wheel", handleWheel);
      scrollContainer.removeEventListener("touchstart", handleTouchStart);
      scrollContainer.removeEventListener("touchmove", handleTouchMove);
      scrollContainer.removeEventListener("touchend", handleTouchEnd);
      scrollContainer.removeEventListener("pointerdown", handlePointerDown);
      scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [scrollContainer]);

  const handleFollowOutput = useCallback((_isAtBottom: boolean) => {
    if (shouldSnapToBottomRef.current) {
      shouldSnapToBottomRef.current = false;
      return "auto" as const;
    }
    return userScrolledAwayRef.current ? false : ("auto" as const);
  }, []);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    if (atBottom && userReturningToBottomRef.current) {
      userScrolledAwayRef.current = false;
      userReturningToBottomRef.current = false;
      setHasUserLeftLiveEdge(false);
    }
    setIsScrolledUp(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    userScrolledAwayRef.current = false;
    userReturningToBottomRef.current = false;
    setIsScrolledUp(false);
    setHasUserLeftLiveEdge(false);
    virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "auto" });
  }, []);

  const handleScrollerRef = useCallback((ref: HTMLElement | Window | null) => {
    if (ref instanceof HTMLElement) {
      ref.setAttribute("data-message-scroll-container", "true");
      setScrollContainer(ref);
      return;
    }
    setScrollContainer(null);
  }, []);

  if (messages.length === 0) {
    return (
      <div className="h-full w-full overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-8 custom-scrollbar overscroll-y-none overscroll-x-none">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        followOutput={handleFollowOutput}
        atBottomStateChange={handleAtBottomStateChange}
        atBottomThreshold={50}
        itemContent={(_index, message) => (
          <div className="mx-auto w-full max-w-[920px] px-5 sm:px-8">
            {message.role === "user" ? (
              <UserMessage message={message} />
            ) : (
              <AssistantMessage message={message} />
            )}
          </div>
        )}
        components={{
          Header: () => <div className="h-5" />,
          Footer: () => (
            <div className="px-5 sm:px-8">
              {shouldShowPendingAssistantRow ? <PendingAssistantRow /> : null}
              <div className="h-5" />
            </div>
          ),
        }}
        scrollerRef={handleScrollerRef}
        className="h-full w-full overflow-x-hidden custom-scrollbar overscroll-y-none overscroll-x-none"
      />

      {isScrolledUp && hasUserLeftLiveEdge ? (
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
