import { useRef, useEffect, useState, useMemo } from "react";
import { useAtom } from "jotai";
import type { ChatMessage } from "../../types";
import { messagesAtom, isAgentIdleAtom, isRunningAtom } from "../../store/chat";
import { MessageItem } from "./MessageItem";
import { EmptyState } from "./EmptyState";

function BouncingDots() {
  return (
    <div className="flex h-6 items-center gap-1.5">
      {[0, 150, 300].map((delay) => (
        <div
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-300"
          style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }}
        />
      ))}
    </div>
  );
}

function ToolGroupRow({ messages, showAvatar }: { messages: ChatMessage[], showAvatar: boolean }) {
  const [forceExpand, setForceExpand] = useState(0);

  const handleToolToggle = (isOpen: boolean) => {
    if (isOpen) {
      setForceExpand(prev => (prev > 0 ? prev + 1 : 1));
    } else {
      setForceExpand(prev => (prev < 0 ? prev - 1 : -1));
    }
  };

  return (
    <div className="flex flex-col w-full">
      <div className={`mr-auto flex w-full max-w-[95%] items-center gap-4 ${showAvatar ? 'mt-8' : 'mt-1.5'}`}>
        <div className="w-8 shrink-0 flex justify-center">
        </div>
        <div className="flex-1 flex justify-between items-center mb-1 pr-1">
          <span className="text-xs font-medium text-stone-400">使用了 {messages.length} 个工具</span>
        </div>
      </div>
      {messages.map((message, index) => (
        <MessageItem 
          key={message.id} 
          message={message} 
          showAvatar={showAvatar && index === 0} 
          forceExpandTool={forceExpand}
          onToolToggle={handleToolToggle}
        />
      ))}
    </div>
  );
}

function PendingAssistantRow({ showDots }: { showDots: boolean }) {
  return (
    <div className="mr-auto mt-8 flex w-full max-w-[95%] items-start gap-4">
      <div className="mt-1 flex w-8 shrink-0 justify-center">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm ring-1 ring-blue-600/50">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="mb-2 mt-0.5 flex items-center gap-2">
          <span className="text-[14px] font-semibold tracking-tight text-stone-800">Zora</span>
          <span className="mt-[2px] text-[11px] font-medium text-stone-400">
            {new Date().toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false
            })}
          </span>
        </div>

        {showDots ? <BouncingDots /> : null}
      </div>
    </div>
  );
}

/**
 * 消息列表组件
 * 显示所有消息并自动滚动到底部
 */
export function MessageList() {
  const [messages] = useAtom(messagesAtom);
  const [isAgentIdle] = useAtom(isAgentIdleAtom);
  const [isRunning] = useAtom(isRunningAtom);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsScrolledUp(distanceFromBottom > 50);
  };

  const scrollToBottom = () => {
    setIsScrolledUp(false);
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  const lastUserIndex = useMemo(
    () => messages.reduce((acc, msg, i) => (msg.role === "user" ? i : acc), -1),
    [messages]
  );

  const hasAssistantInCurrentTurn = useMemo(
    () => lastUserIndex >= 0 && messages.slice(lastUserIndex + 1).some((m) => m.role === "assistant"),
    [messages, lastUserIndex]
  );

  const groupedMessages = useMemo(() => {    const groups: (ChatMessage | ChatMessage[])[] = [];
    let currentToolGroup: ChatMessage[] = [];

    messages.forEach((msg) => {
      if (msg.type === "tool_use" || msg.toolName) {
        currentToolGroup.push(msg);
      } else {
        if (currentToolGroup.length > 0) {
          groups.push([...currentToolGroup]);
          currentToolGroup = [];
        }
        groups.push(msg);
      }
    });

    if (currentToolGroup.length > 0) {
      groups.push([...currentToolGroup]);
    }

    return groups;
  }, [messages]);

  const messageIndexMap = useMemo(
    () => new Map(messages.map((m, i) => [m.id, i])),
    [messages]
  );

  useEffect(() => {
    if (!isScrolledUp) {
      scrollAnchorRef.current?.scrollIntoView({
        behavior: isRunning ? "auto" : "smooth",
        block: "end"
      });
    }
  }, [messages, isAgentIdle, isRunning, isScrolledUp]);

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
        className="h-full w-full overflow-y-auto px-5 py-5 sm:px-8 custom-scrollbar overscroll-none"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        <div className="mx-auto flex max-w-4xl flex-col pb-4">
          {groupedMessages.map((item) => {
        if (Array.isArray(item)) {
          const firstMsg = item[0];
          const globalIndex = messageIndexMap.get(firstMsg.id) ?? -1;
          const prevMessage = globalIndex > 0 ? messages[globalIndex - 1] : null;
          const showAvatar = (!prevMessage || prevMessage.role !== "assistant");

          return <ToolGroupRow key={firstMsg.id} messages={item} showAvatar={showAvatar} />;
        } else {
          const globalIndex = messageIndexMap.get(item.id) ?? -1;
          const isAssistant = item.role === "assistant";
          const prevMessage = globalIndex > 0 ? messages[globalIndex - 1] : null;
          const showAvatar = isAssistant && (!prevMessage || prevMessage.role !== "assistant");

          return <MessageItem key={item.id} message={item} showAvatar={showAvatar} />;
        }
      })}

      {isRunning && !hasAssistantInCurrentTurn ? (
        <PendingAssistantRow showDots={isAgentIdle} />
      ) : null}

      {isRunning && hasAssistantInCurrentTurn && isAgentIdle ? (
        <div className="mr-auto mt-1 flex w-full max-w-[95%] items-start gap-4">
          <div className="w-8 shrink-0" />
          <BouncingDots />
        </div>
      ) : null}
      
        <div ref={scrollAnchorRef} className="h-4" />
      </div>
    </div>

      {isScrolledUp && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white p-2 shadow-md border border-stone-200 text-stone-500 hover:text-stone-900 z-50 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
          title="回到底部"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </div>
  );
}
