import { useRef, useEffect } from "react";
import { useAtom } from "jotai";
import { messagesAtom } from "../../store/chat";
import { MessageItem } from "./MessageItem";
import { EmptyState } from "./EmptyState";

/**
 * 消息列表组件
 * 显示所有消息并自动滚动到底部
 */
export function MessageList() {
  const [messages] = useAtom(messagesAtom);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  // 自动滚动到底部
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  }, [messages]);

  if (messages.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      <div ref={scrollAnchorRef} />
    </div>
  );
}
