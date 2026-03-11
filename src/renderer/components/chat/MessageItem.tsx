import type { ChatMessage } from "../../types";
import { cn } from "../../utils/cn";

export interface MessageItemProps {
  message: ChatMessage;
}

/**
 * 单条消息组件
 * 渲染用户或助手的消息，包括思考内容和错误信息
 */
export function MessageItem({ message }: MessageItemProps) {
  return (
    <article
      className={cn(
        "rounded-[26px] px-4 py-4 shadow-[0_16px_45px_rgba(70,40,20,0.06)] sm:px-5",
        message.role === "user"
          ? "ml-auto max-w-[85%] border border-stone-900/8 bg-stone-950 text-stone-50"
          : "mr-auto max-w-[90%] border border-stone-900/8 bg-white/85 text-stone-900"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-current/60">
          {message.role === "user" ? "You" : "Agent"}
        </div>
        {message.role === "assistant" && message.status === "streaming" ? (
          <div className="flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.2em] text-amber-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-600" />
            Live
          </div>
        ) : null}
      </div>

      {message.thinking ? (
        <details className="mt-4 overflow-hidden rounded-[18px] border border-stone-900/8 bg-stone-200/65 text-stone-700">
          <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em]">
            Thinking Trace
          </summary>
          <div className="border-t border-stone-900/8 px-4 py-3 text-sm leading-7 text-stone-700">
            <pre className="m-0 whitespace-pre-wrap font-inherit">{message.thinking}</pre>
          </div>
        </details>
      ) : null}

      <div className="mt-4 whitespace-pre-wrap text-sm leading-7 sm:text-[0.96rem]">
        {message.text || (
          <span className="text-stone-500">Waiting for the first token...</span>
        )}
      </div>

      {message.error ? (
        <div className="mt-4 rounded-2xl border border-rose-900/10 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">
          {message.error}
        </div>
      ) : null}
    </article>
  );
}
