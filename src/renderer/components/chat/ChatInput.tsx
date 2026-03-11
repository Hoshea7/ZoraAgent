import { useAtom } from "jotai";
import { draftAtom, isRunningAtom } from "../../store/chat";
import { Button } from "../ui/Button";

export interface ChatInputProps {
  onSubmit: () => void;
  onStop: () => void;
}

/**
 * 聊天输入框组件
 * 包含输入框、发送按钮和停止按钮
 */
export function ChatInput({ onSubmit, onStop }: ChatInputProps) {
  const [draft, setDraft] = useAtom(draftAtom);
  const [isRunning] = useAtom(isRunningAtom);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="rounded-[22px] border border-stone-200 bg-white px-4 py-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)] focus-within:border-stone-300 focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.06)] transition-all">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="给 Zora 发消息..."
        className="min-h-[56px] w-full resize-none border-0 bg-transparent px-1 py-1.5 text-[15px] leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
      />

      <div className="flex items-center justify-between pt-2 pb-1">
        <div className="pl-1 text-[12px] font-medium text-stone-400">
          Enter 发送 <span className="mx-1 text-stone-300">/</span> Shift+Enter 换行
        </div>
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Button
              variant="secondary"
              onClick={onStop}
            >
              停止
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={!draft.trim() || isRunning}
            className="px-5 shadow-sm"
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
