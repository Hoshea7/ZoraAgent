/**
 * 空状态组件
 * 当没有消息时显示的提示界面
 */
export function EmptyState() {
  return (
    <div className="flex h-full min-h-[26rem] items-center justify-center p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-stone-100">
          <svg
            className="h-8 w-8 text-stone-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <h2 className="text-2xl font-medium tracking-[-0.02em] text-stone-900">
          开始使用
        </h2>
        <p className="mt-3 text-sm leading-7 text-stone-500">
          在下方输入框发送消息，即可开始对话
        </p>
      </div>
    </div>
  );
}
