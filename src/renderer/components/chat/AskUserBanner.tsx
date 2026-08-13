import { useState, useEffect } from "react";
import { useAtom, useSetAtom } from "jotai";
import { pendingAskUserQuestionsAtom, removeAskUserQuestionAtom } from "../../store/hitl";

const QuestionMark = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
    <circle cx="12" cy="12" r="10" />
  </svg>
);

export function AskUserBanner() {
  const [askUserQuestions] = useAtom(pendingAskUserQuestionsAtom);
  const removeAskUserQuestion = useSetAtom(removeAskUserQuestionAtom);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customMode, setCustomMode] = useState<Record<string, boolean>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});

  const current = askUserQuestions[0];
  const remaining = askUserQuestions.length - 1;
  const questionCount = current?.questions.length ?? 0;

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
    setCustomMode((prev) => ({ ...prev, [qIndex]: false }));
    setCustomText((prev) => ({ ...prev, [qIndex]: "" }));
  };

  /** 进入自由输入模式 */
  const enterCustomMode = (qIndex: string) => {
    setCustomMode((prev) => ({ ...prev, [qIndex]: true }));
    setAnswers((prev) => ({ ...prev, [qIndex]: "" }));
    setCustomText((prev) => ({ ...prev, [qIndex]: "" }));
  };

  /** 自由输入文本变化 */
  const updateCustomText = (qIndex: string, value: string) => {
    setCustomText((prev) => ({ ...prev, [qIndex]: value }));
    setAnswers((prev) => ({ ...prev, [qIndex]: value }));
  };

  const handleSubmit = () => {
    window.zora.answerAskUserQuestion({
      requestId: current.requestId,
      answers,
    });
    removeAskUserQuestion(current.requestId);
  };

  const handleSkip = () => {
    window.zora.answerAskUserQuestion({
      requestId: current.requestId,
      answers: { "0": "（用户跳过了这个问题）" },
    });
    removeAskUserQuestion(current.requestId);
  };

  const hasAnyAnswer = Object.values(answers).some((v) => v && v.trim().length > 0);

  return (
    <div
      data-testid="ask-user-banner"
      className="mb-3 flex max-h-[min(50vh,400px)] flex-col overflow-hidden rounded-2xl bg-white/95 shadow-[0_4px_24px_rgb(0,0,0,0.06)] backdrop-blur-xl transition-all duration-300"
    >
      {/* 标题行（固定） */}
      <div className="flex shrink-0 items-start gap-3 border-b border-stone-100 px-4 py-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600">
          <QuestionMark />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-stone-800">Zora 需要你的回答</h3>
            {remaining > 0 && (
              <span className="rounded bg-stone-200/50 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                +{remaining}
              </span>
            )}
          </div>
          {questionCount > 1 && (
            <p className="mt-0.5 text-[11px] text-stone-400">共 {questionCount} 个问题</p>
          )}
        </div>
      </div>

      {/* 问题列表（可滚动） */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 custom-scrollbar">
        {current.questions.map((q, idx) => {
          const qIndex = String(idx);
          const selectedAnswer = answers[qIndex] || "";
          const isCustom = customMode[qIndex] || false;
          const hasOptions = q.options && q.options.length > 0;

          return (
            <div key={qIndex} className="mb-4 last:mb-0">
              <p className="mb-2 text-[13px] font-medium text-stone-700">{q.question}</p>

              {/* 预设选项 */}
              {hasOptions && (
                <div className="mb-2 flex flex-col gap-1">
                  {q.options!.map((opt, optIdx) => (
                    <button
                      key={optIdx}
                      onClick={() => selectOption(qIndex, opt.label)}
                      className={`rounded-lg border px-3 py-1.5 text-left text-[13px] transition-colors ${
                        selectedAnswer === opt.label && !isCustom
                          ? "border-stone-400 bg-stone-100 text-stone-900"
                          : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50"
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
                    className={`rounded-lg border px-3 py-1.5 text-left text-[13px] transition-colors ${
                      isCustom
                        ? "border-stone-400 bg-stone-100 text-stone-900"
                        : "border-dashed border-stone-300 bg-white/40 text-stone-400 hover:border-stone-300 hover:text-stone-600"
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
                  className="w-full resize-none rounded-lg border border-stone-200 bg-white px-3 py-2 text-[13px] text-stone-700 placeholder-stone-400 outline-none transition-colors focus:border-stone-300 focus:ring-2 focus:ring-stone-200/60"
                  rows={2}
                  placeholder="输入你的想法..."
                  value={customText[qIndex] || ""}
                  onChange={(e) => updateCustomText(qIndex, e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 按钮行（固定） */}
      <div className="flex shrink-0 items-center justify-between border-t border-stone-100 px-4 py-3">
        <button
          onClick={handleSkip}
          className="text-[12px] font-medium text-stone-400 transition-colors hover:text-stone-600"
        >
          跳过
        </button>
        <button
          onClick={handleSubmit}
          disabled={!hasAnyAnswer}
          className="rounded-lg bg-stone-800 px-4 py-1.5 text-[13px] font-medium text-white shadow-sm transition-all hover:bg-stone-900 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
        >
          提交
        </button>
      </div>
    </div>
  );
}
