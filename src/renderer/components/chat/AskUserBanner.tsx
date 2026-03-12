import { useState, useEffect } from "react";
import { useAtom, useSetAtom } from "jotai";
import { pendingAskUsersAtom, resolveAskUserAtom } from "../../store/hitl";

export function AskUserBanner() {
  const [askUsers] = useAtom(pendingAskUsersAtom);
  const resolveAskUser = useSetAtom(resolveAskUserAtom);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customMode, setCustomMode] = useState<Record<string, boolean>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});

  const current = askUsers[0];
  const remaining = askUsers.length - 1;

  // 切换到新请求时重置所有状态
  useEffect(() => {
    setAnswers({});
    setCustomMode({});
    setCustomText({});
  }, [current?.requestId]);

  if (!current) return null;

  /** 选中一个预设选项 */
  const selectOption = (qIndex: string, label: string) => {
    setAnswers((prev) => ({ ...prev, [qIndex]: label }));
    // 选中预设时退出自由输入模式并清空自由文本
    setCustomMode((prev) => ({ ...prev, [qIndex]: false }));
    setCustomText((prev) => ({ ...prev, [qIndex]: "" }));
  };

  /** 进入自由输入模式 */
  const enterCustomMode = (qIndex: string) => {
    setCustomMode((prev) => ({ ...prev, [qIndex]: true }));
    // 清空之前选中的预设选项，让 answer 由自由文本驱动
    setAnswers((prev) => ({ ...prev, [qIndex]: "" }));
    setCustomText((prev) => ({ ...prev, [qIndex]: "" }));
  };

  /** 自由输入文本变化 */
  const updateCustomText = (qIndex: string, value: string) => {
    setCustomText((prev) => ({ ...prev, [qIndex]: value }));
    setAnswers((prev) => ({ ...prev, [qIndex]: value }));
  };

  const handleSubmit = () => {
    window.zora.respondAskUser({
      requestId: current.requestId,
      answers,
    });
    resolveAskUser(current.requestId);
  };

  const hasAnyAnswer = Object.values(answers).some((v) => v && v.trim().length > 0);

  return (
    <div className="mx-4 mb-2 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 shadow-sm">
      {/* 标题行 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-orange-100">
            <svg className="h-3 w-3 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-[13px] font-semibold text-stone-800">Zora 需要你的回答</span>
        </div>
        {remaining > 0 && (
          <span className="rounded-full bg-amber-200/60 px-2 py-0.5 text-[11px] font-medium text-amber-700">+{remaining}</span>
        )}
      </div>

      {/* 问题列表 */}
      {current.questions.map((q, idx) => {
        const qIndex = String(idx);
        const selectedAnswer = answers[qIndex] || "";
        const isCustom = customMode[qIndex] || false;
        const hasOptions = q.options && q.options.length > 0;

        return (
          <div key={qIndex} className="mb-3">
            <p className="mb-2 text-[13px] font-medium text-stone-700">{q.question}</p>

            {/* 预设选项 */}
            {hasOptions && (
              <div className="mb-2 flex flex-col gap-1">
                {q.options!.map((opt, optIdx) => (
                  <button
                    key={optIdx}
                    onClick={() => selectOption(qIndex, opt.label)}
                    className={`rounded-lg border px-3 py-2 text-left text-[13px] transition-colors ${
                      selectedAnswer === opt.label && !isCustom
                        ? "border-amber-400 bg-amber-100/80 text-stone-800"
                        : "border-stone-200 bg-white/60 text-stone-600 hover:border-amber-300 hover:bg-amber-50/50"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {opt.description && (
                      <span className="ml-2 text-[12px] text-stone-400">{opt.description}</span>
                    )}
                  </button>
                ))}

                {/* 自由输入入口 */}
                <button
                  onClick={() => enterCustomMode(qIndex)}
                  className={`rounded-lg border px-3 py-2 text-left text-[13px] transition-colors ${
                    isCustom
                      ? "border-amber-400 bg-amber-100/80 text-stone-800"
                      : "border-dashed border-stone-300 bg-white/40 text-stone-400 hover:border-amber-300 hover:text-stone-600"
                  }`}
                >
                  输入你的想法...
                </button>
              </div>
            )}

            {/* 自由输入文本框：无预设选项时始终显示，有预设选项时点击入口后展开 */}
            {(!hasOptions || isCustom) && (
              <textarea
                autoFocus={isCustom}
                className="w-full resize-none rounded-lg border border-stone-200 bg-white px-3 py-2 text-[13px] text-stone-700 placeholder-stone-400 outline-none transition-colors focus:border-amber-300 focus:ring-1 focus:ring-amber-200"
                rows={2}
                placeholder="输入你的想法..."
                value={customText[qIndex] || ""}
                onChange={(e) => updateCustomText(qIndex, e.target.value)}
              />
            )}
          </div>
        );
      })}

      {/* 按钮行 */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            window.zora.respondAskUser({
              requestId: current.requestId,
              answers: { "0": "（用户跳过了这个问题）" },
            });
            resolveAskUser(current.requestId);
          }}
          className="text-[12px] text-stone-400 underline decoration-stone-300 underline-offset-2 hover:text-stone-600 hover:decoration-stone-500"
        >
          跳过
        </button>
        <button
          onClick={handleSubmit}
          disabled={!hasAnyAnswer}
          className="rounded-lg bg-orange-500 px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          提交
        </button>
      </div>
    </div>
  );
}
