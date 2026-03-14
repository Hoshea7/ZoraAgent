import { useRef, useEffect, useState } from "react";
import { useAtom } from "jotai";
import { draftAtom, isRunningAtom } from "../../store/chat";
import { Button } from "../ui/Button";
import { PermissionModeButton } from "./PermissionModeButton";

export interface ChatInputProps {
  onSubmit: () => void;
  onStop: () => void;
}

export function ChatInput({ onSubmit, onStop }: ChatInputProps) {
  const [draft, setDraft] = useAtom(draftAtom);
  const [isRunning] = useAtom(isRunningAtom);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showToast, setShowToast] = useState(false);

  // Auto-resize textarea
  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`; // Max height around ~25vh
    }
  };

  useEffect(() => {
    handleInput();
  }, [draft]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!isRunning && draft.trim()) {
        onSubmit();
      } else if (isRunning) {
        setShowToast(true);
        setTimeout(() => setShowToast(false), 2000);
      }
    }
  };

  return (
    <div className="relative">
      <div 
        className={`absolute -top-12 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-xs px-3 py-1.5 rounded-md shadow-lg transition-all duration-300 pointer-events-none z-50 ${
          showToast ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-2'
        }`}
      >
        先停止对话才能发送消息
      </div>

      <div className="relative flex flex-col rounded-[24px] border border-stone-200 bg-white p-3 shadow-[0_2px_12px_rgba(0,0,0,0.04)] focus-within:border-stone-300 focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.06)] transition-all">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="给 Zora 发消息… Enter 发送，Shift+Enter 换行"
          className="w-full resize-none border-0 bg-transparent px-2 py-1 text-[15px] leading-[1.6] text-stone-900 outline-none placeholder:text-stone-400 custom-scrollbar"
          rows={1}
          style={{ minHeight: "26px", maxHeight: "180px" }}
        />

        <div className="flex items-end justify-between mt-2 px-1 pb-0.5">
          <PermissionModeButton />
          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button
                variant="primary"
                onClick={onStop}
                className="w-8 h-8 p-0 rounded-full shadow-sm !bg-stone-800 hover:!bg-stone-900 focus:!ring-stone-400 flex items-center justify-center cursor-pointer"
                title="停止"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={onSubmit}
                disabled={!draft.trim()}
                className="w-8 h-8 p-0 rounded-full shadow-sm flex items-center justify-center cursor-pointer"
                title="发送"
              >
                <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
