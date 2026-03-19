import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import { isRunningAtom, messagesAtom } from "../../store/chat";
import { currentSessionIdAtom } from "../../store/workspace";
import { AssistantMessage } from "./AssistantMessage";
import { BouncingDots } from "./BouncingDots";
import { EmptyState } from "./EmptyState";
import { UserMessage, ZoraAvatar } from "./UserMessage";

function PendingAssistantRow() {
  return (
    <div className="mr-auto mt-8 flex w-full max-w-[95%] items-start gap-4">
      <div className="mt-1 flex w-8 shrink-0 justify-center">
        <ZoraAvatar />
      </div>
      <div className="flex-1 overflow-hidden">
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
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const previousSessionIdRef = useRef<string | null>(currentSessionId);
  const shouldSnapToBottomRef = useRef(false);
  const rafIdRef = useRef(0);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const lastMessage = messages[messages.length - 1];
  const shouldShowPendingAssistantRow = isRunning && lastMessage?.role !== "assistant";

  useEffect(() => {
    if (previousSessionIdRef.current !== currentSessionId) {
      previousSessionIdRef.current = currentSessionId;
      shouldSnapToBottomRef.current = true;
      setIsScrolledUp(false);
    }
  }, [currentSessionId]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    if (shouldSnapToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
      shouldSnapToBottomRef.current = false;
      return;
    }

    if (!isScrolledUp && isRunning) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      });
      return;
    }

    if (!isScrolledUp) {
      container.scrollTop = container.scrollHeight;
    }
  }, [currentSessionId, isRunning, isScrolledUp, messages]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  if (messages.length === 0) {
    return (
      <div className="h-full w-full overflow-y-auto px-5 py-5 sm:px-8 custom-scrollbar overscroll-none">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={scrollContainerRef}
        onScroll={() => {
          const element = scrollContainerRef.current;
          if (!element) {
            return;
          }

          const distanceFromBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight;
          setIsScrolledUp(distanceFromBottom > 50);
        }}
        className="h-full w-full overflow-y-auto px-5 py-5 sm:px-8 custom-scrollbar overscroll-none"
      >
        <div className="mx-auto flex max-w-4xl flex-col pb-4">
          {messages.map((message) =>
            message.role === "user" ? (
              <UserMessage key={message.id} message={message} />
            ) : (
              <AssistantMessage key={message.id} message={message} />
            )
          )}

          {shouldShowPendingAssistantRow ? <PendingAssistantRow /> : null}

          <div className="h-4" />
        </div>
      </div>

      {isScrolledUp ? (
        <button
          type="button"
          onClick={() => {
            const container = scrollContainerRef.current;
            if (!container) {
              return;
            }

            setIsScrolledUp(false);
            container.scrollTop = container.scrollHeight;
          }}
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
