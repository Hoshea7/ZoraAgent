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
  const previousSessionIdRef = useRef<string | null>(currentSessionId);
  const shouldSnapToBottomRef = useRef(false);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const lastMessage = messages[messages.length - 1];
  const shouldShowPendingAssistantRow =
    isRunning &&
    lastMessage?.role !== "assistant" &&
    lastMessage?.queueState !== "pending";

  useEffect(() => {
    if (previousSessionIdRef.current !== currentSessionId) {
      previousSessionIdRef.current = currentSessionId;
      shouldSnapToBottomRef.current = true;
      setIsScrolledUp(false);
    }
  }, [currentSessionId]);

  const handleFollowOutput = useCallback((isAtBottom: boolean) => {
    if (shouldSnapToBottomRef.current) {
      shouldSnapToBottomRef.current = false;
      return "auto" as const;
    }
    return isAtBottom ? ("auto" as const) : false;
  }, []);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setIsScrolledUp(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    setIsScrolledUp(false);
    virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "smooth" });
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
        scrollerRef={(ref) => {
          if (ref instanceof HTMLElement) {
            ref.setAttribute("data-message-scroll-container", "true");
          }
        }}
        className="h-full w-full overflow-x-hidden custom-scrollbar overscroll-y-none overscroll-x-none"
      />

      {isScrolledUp ? (
        <button
          type="button"
          onClick={scrollToBottom}
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
