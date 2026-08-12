export function TransientChatNotice({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="animate-in fade-in slide-in-from-bottom-2 flex max-w-[90%] items-center gap-2 rounded-xl border border-stone-200 bg-white/95 px-4 py-2 text-center text-xs leading-relaxed text-stone-700 shadow-lg backdrop-blur-sm duration-300"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0 text-stone-500"
        aria-hidden="true"
      >
        <path d="m9 12 2 2 4-4" />
        <circle cx="12" cy="12" r="9" />
      </svg>
      {message}
    </div>
  );
}
