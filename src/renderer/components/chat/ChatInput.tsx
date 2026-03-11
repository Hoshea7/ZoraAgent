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
    <div className="rounded-2xl border border-stone-200/80 bg-stone-50/50 px-4 py-2.5">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="给 Zora 发消息..."
        className="min-h-[56px] w-full resize-none border-0 bg-transparent px-1 py-1.5 text-sm leading-6 text-stone-900 outline-none placeholder:text-stone-400"
      />

      <div className="flex items-center justify-between pt-1.5">
        <div className="text-[0.68rem] tracking-wide text-stone-400">
          Enter 发送 · Shift+Enter 换行
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={onStop}
            disabled={!isRunning}
          >
            停止
          </Button>
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={!draft.trim() || isRunning}
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
