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
    <div className="rounded-[26px] border border-stone-900/10 bg-white/85 p-3 shadow-[0_15px_35px_rgba(90,55,28,0.08)]">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask Claude Agent anything..."
        className="min-h-[96px] w-full resize-none border-0 bg-transparent px-2 py-2 text-base leading-7 text-stone-900 outline-none placeholder:text-stone-400"
      />

      <div className="mt-3 flex flex-col gap-3 border-t border-stone-900/8 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs uppercase tracking-[0.22em] text-stone-500">
          Enter to send • Shift + Enter for newline
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={onStop}
            disabled={!isRunning}
          >
            Stop
          </Button>
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={!draft.trim() || isRunning}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
