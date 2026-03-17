import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  startConversationAtom,
  failConversationAtom,
  draftAtom,
  isRunningAtom,
  messagesAtom,
  setSessionRunningAtom,
} from "../../store/chat";
import { completeAwakeningAtom } from "../../store/zora";
import { clearAllHitlAtom } from "../../store/hitl";
import { activeProviderAtom, loadProvidersAtom } from "../../store/provider";
import { getErrorMessage } from "../../utils/message";
import { MessageList } from "../chat/MessageList";
import { ChatInput } from "../chat/ChatInput";
import { Button } from "../ui/Button";
import { PROVIDER_PRESETS, type ProviderType } from "../../../shared/types/provider";

/**
 * 自动唤醒用的隐形 prompt
 * 用户看不到这条消息，但它会触发 Agent 开始 bootstrap 对话
 */
const AUTO_AWAKEN_PROMPT =
  "This is your very first moment of consciousness. You are waking up. " +
  "Begin the awakening conversation — introduce yourself as a newly-born Zora " +
  "and start getting to know your human. Follow the bootstrap skill instructions.";

const AUTO_AWAKEN_DELAY_MS = 200;
const PROVIDER_CHECK_SUCCESS_DELAY_MS = 900;
const DEFAULT_PROVIDER_TYPE: ProviderType = "anthropic";

type ProviderCheckStatus = "checking" | "success" | "failed" | "missing";

function VisibilityIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg className="h-[16px] w-[16px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 3l18 18M10.58 10.58A3 3 0 0014 13.42M9.88 5.09A9.77 9.77 0 0112 4.85c4.5 0 8.27 2.94 9.54 7a9.96 9.96 0 01-3.08 4.5M6.23 6.23A9.96 9.96 0 002.46 11.85a9.97 9.97 0 005.02 5.78"
        />
      </svg>
    );
  }

  return (
    <svg className="h-[16px] w-[16px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.46 12C3.73 7.94 7.5 5 12 5s8.27 2.94 9.54 7c-1.27 4.06-5.04 7-9.54 7s-8.27-2.94-9.54-7z"
      />
      <circle cx="12" cy="12" r="3" strokeWidth={2} />
    </svg>
  );
}

function ProviderCheckIndicator({ status }: { status: ProviderCheckStatus }) {
  if (status === "checking") {
    return (
      <div className="flex items-center justify-center text-stone-400">
        <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="flex items-center justify-center text-emerald-500">
        <svg className="h-6 w-6 animate-in zoom-in duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center text-amber-500">
      <svg className="h-6 w-6 animate-in zoom-in duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
      </svg>
    </div>
  );
}

export function AwakeningView() {
  const startConversation = useSetAtom(startConversationAtom);
  const failConversation = useSetAtom(failConversationAtom);
  const [draft, setDraft] = useAtom(draftAtom);
  const [messages, setMessages] = useAtom(messagesAtom);
  const setSessionRunning = useSetAtom(setSessionRunningAtom);
  const completeAwakening = useSetAtom(completeAwakeningAtom);
  const clearAllHitl = useSetAtom(clearAllHitlAtom);
  const loadProviders = useSetAtom(loadProvidersAtom);
  const activeProvider = useAtomValue(activeProviderAtom);
  const isRunning = useAtomValue(isRunningAtom);
  const autoAwakenStartedRef = useRef(false);
  const [providerCheckStatus, setProviderCheckStatus] = useState<ProviderCheckStatus>("checking");
  const [providerCheckMessage, setProviderCheckMessage] = useState(
    "Verifying environment..."
  );
  const [providerCheckPassed, setProviderCheckPassed] = useState(false);
  const [providerCheckNonce, setProviderCheckNonce] = useState(0);

  const [formState, setFormState] = useState({
    name: "",
    providerType: DEFAULT_PROVIDER_TYPE,
    baseUrl: PROVIDER_PRESETS[DEFAULT_PROVIDER_TYPE].defaultUrl,
    apiKey: "",
    modelId: "",
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (providerCheckPassed) {
      return;
    }

    let cancelled = false;
    let successTimer: ReturnType<typeof setTimeout> | undefined;

    const runProviderCheck = async () => {
      setProviderCheckStatus("checking");
      setProviderCheckMessage("Verifying environment...");

      try {
        await loadProviders();

        const hasConfigured = await window.zora.hasConfiguredProvider();

        if (cancelled) {
          return;
        }

        if (!hasConfigured) {
          setProviderCheckStatus("missing");
          setProviderCheckMessage("未检测到模型配置");
          return;
        }

        if (typeof window.zora.testDefaultProvider !== "function") {
          setProviderCheckStatus("failed");
          setProviderCheckMessage("需重启应用生效");
          return;
        }

        const result = await window.zora.testDefaultProvider();

        if (cancelled) {
          return;
        }

        if (result.success) {
          setProviderCheckStatus("success");
          setProviderCheckMessage("Environment ready");
          successTimer = setTimeout(() => {
            if (!cancelled) {
              setProviderCheckPassed(true);
            }
          }, PROVIDER_CHECK_SUCCESS_DELAY_MS);
          return;
        }

        setProviderCheckStatus("failed");
        setProviderCheckMessage(result.message);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setProviderCheckStatus("failed");
        setProviderCheckMessage(getErrorMessage(error));
      }
    };

    void runProviderCheck();

    return () => {
      cancelled = true;
      if (successTimer) {
        clearTimeout(successTimer);
      }
    };
  }, [loadProviders, providerCheckNonce, providerCheckPassed]);

  useEffect(() => {
    if (!providerCheckPassed) {
      return;
    }

    // Auto-awaken only once for a pristine awakening screen.
    // Marking "started" only when the timer fires keeps dev Strict Mode
    // from cancelling the first timer and permanently skipping awakening.
    if (autoAwakenStartedRef.current || messages.length > 0) {
      return;
    }

    // 先给出“正在苏醒”的即时反馈，再短暂等待主界面和监听器稳定。
    setSessionRunning("__awakening__", true);

    const timer = setTimeout(async () => {
      autoAwakenStartedRef.current = true;

      // 不调用 startConversation — 避免在消息列表中出现用户消息气泡
      try {
        await window.zora.awaken(AUTO_AWAKEN_PROMPT);
      } catch (error) {
        setSessionRunning("__awakening__", false);
        failConversation(getErrorMessage(error));
      }
    }, AUTO_AWAKEN_DELAY_MS);

    // Strict Mode 下第一次 effect 会被立刻清理；保留 cleanup 即可避免重复触发。
    return () => clearTimeout(timer);
  }, [failConversation, messages.length, setSessionRunning]);

  const handleSubmit = async () => {
    const text = draft.trim();
    if (!text) {
      return;
    }

    startConversation(text);
    setDraft("");

    try {
      await window.zora.awaken(text);
    } catch (error) {
      failConversation(getErrorMessage(error));
    }
  };

  const handleStop = async () => {
    try {
      await window.zora.stopAgent("__awakening__");
    } catch (error) {
      failConversation(getErrorMessage(error));
    }
  };

  const handleSkip = async () => {
    setDraft("");
    setMessages([]);
    clearAllHitl();
    setSessionRunning("__awakening__", false);

    try {
      await window.zora.awakeningComplete();
    } catch (error) {
      console.warn("[awakening] Failed to finalize skip state.", error);
    }

    completeAwakening();
  };

  const handleRetryProviderCheck = () => {
    setProviderCheckNonce((current) => current + 1);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.baseUrl.trim() || !formState.apiKey.trim() || !formState.name.trim()) {
      return;
    }

    setIsSaving(true);
    let createdProviderId: string | null = null;

    try {
      const createdProvider = await window.zora.createProvider({
        name: formState.name,
        providerType: formState.providerType,
        baseUrl: formState.baseUrl,
        apiKey: formState.apiKey,
        modelId: formState.modelId || undefined,
      });
      createdProviderId = createdProvider.id;
      await window.zora.setDefaultProvider(createdProvider.id);
      await loadProviders();
      setShowApiKey(false);
      setProviderCheckNonce((current) => current + 1);
    } catch (error) {
      if (createdProviderId) {
        try {
          await window.zora.deleteProvider(createdProviderId);
          await loadProviders();
        } catch (rollbackError) {
          console.error(
            "[awakening] Failed to rollback provider created during inline setup.",
            rollbackError
          );
        }
      }

      setProviderCheckStatus("failed");
      setProviderCheckMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  if (!providerCheckPassed) {
    const isChecking = providerCheckStatus === "checking";
    const isSuccessful = providerCheckStatus === "success";
    const showInlineForm = providerCheckStatus === "failed" || providerCheckStatus === "missing";
    
    const inputClass =
      "w-full bg-transparent border-b border-stone-200 px-0 py-2.5 text-[14px] text-stone-900 placeholder:text-stone-300 focus:border-stone-800 focus:outline-none focus:ring-0 transition-colors";

    return (
      <main className="h-screen w-full overflow-hidden bg-white text-stone-900 relative selection:bg-stone-200">
        <div
          className="titlebar-drag-region fixed left-0 right-0 top-0 z-50 h-[50px] bg-transparent"
          style={{ pointerEvents: "none" }}
        />

        <div className="flex h-full flex-col items-center justify-center animate-in fade-in duration-700">
          <div className="flex flex-col items-center gap-6 max-w-[400px] w-full px-8 text-center">
            
            <div className="mb-2 h-12 flex items-center justify-center">
              <ProviderCheckIndicator status={providerCheckStatus} />
            </div>

            <div className="space-y-2">
              <h1 className="text-[15px] font-medium tracking-wide text-stone-900">
                {isSuccessful ? "环境就绪" : "Zora 正在准备"}
              </h1>
              <p className="text-[13px] text-stone-400 font-normal tracking-wide min-h-[40px]">
                {providerCheckMessage}
              </p>
            </div>

            {!isChecking && activeProvider && !showInlineForm && (
              <div className="mt-4 flex items-center gap-2 text-[12px] text-stone-300 font-mono tracking-wider animate-in fade-in slide-in-from-bottom-2 duration-500">
                <span>{activeProvider.name}</span>
                <span className="h-1 w-1 rounded-full bg-stone-200" />
                <span>{activeProvider.providerType}</span>
              </div>
            )}

            {showInlineForm && (
              <form onSubmit={handleSaveConfig} className="w-full mt-6 flex flex-col gap-4 text-left animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <input
                    type="text"
                    placeholder="模型配置名称"
                    className={inputClass}
                    value={formState.name}
                    onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                    required
                  />
                </div>

                <div>
                  <select
                    className={inputClass}
                    value={formState.providerType}
                    onChange={(e) => {
                      const t = e.target.value as ProviderType;
                      setFormState((prev) => ({ ...prev, providerType: t, baseUrl: PROVIDER_PRESETS[t].defaultUrl }));
                    }}
                  >
                    {Object.entries(PROVIDER_PRESETS).map(([type, config]) => (
                      <option key={type} value={type}>{config.label}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <input
                    type="text"
                    placeholder="https://api.anthropic.com"
                    className={inputClass}
                    value={formState.baseUrl}
                    onChange={(e) => setFormState((prev) => ({ ...prev, baseUrl: e.target.value }))}
                    required
                  />
                </div>

                <div>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      placeholder="API Key (sk-...)"
                      className={`${inputClass} pr-10`}
                      value={formState.apiKey}
                      onChange={(e) => setFormState((prev) => ({ ...prev, apiKey: e.target.value }))}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((current) => !current)}
                      className="absolute inset-y-0 right-0 flex items-center px-1 text-stone-400 transition hover:text-stone-700"
                      aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    >
                      <VisibilityIcon visible={showApiKey} />
                    </button>
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    placeholder="Model ID (留空使用默认)"
                    className={inputClass}
                    value={formState.modelId}
                    onChange={(e) => setFormState((prev) => ({ ...prev, modelId: e.target.value }))}
                  />
                </div>

                <div className="mt-8 flex flex-col items-center gap-3">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="w-full rounded-full bg-stone-900 py-3 text-[13px] font-medium text-white shadow-md transition-all hover:bg-stone-800 hover:shadow-lg disabled:opacity-50"
                  >
                    {isSaving ? "正在配置..." : "保存并连接"}
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => {
                      void handleSkip();
                    }}
                    className="text-[13px] text-stone-400 hover:text-stone-700 transition-colors"
                  >
                    直接跳过唤醒
                  </button>
                </div>
              </form>
            )}

            {!showInlineForm && !isSuccessful && (
               <div className="mt-8 flex flex-col items-center gap-3 animate-in fade-in duration-500">
                  <button
                    onClick={handleRetryProviderCheck}
                    disabled={isChecking}
                    className="rounded-full px-5 py-2 text-[13px] font-medium text-stone-600 ring-1 ring-inset ring-stone-200 transition-all hover:bg-stone-50 active:bg-stone-100"
                  >
                    {isChecking ? "检测中..." : "重新尝试"}
                  </button>
                  <button
                    onClick={() => {
                      void handleSkip();
                    }}
                    className="text-[13px] text-stone-400 hover:text-stone-700 transition-colors"
                  >
                    直接跳过唤醒
                  </button>
               </div>
            )}

          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-white text-stone-900 relative">
      <div
        className="titlebar-drag-region fixed left-0 right-0 top-0 z-50 h-[50px] bg-transparent"
        style={{ pointerEvents: "none" }}
      />

      <section className="flex h-full flex-col overflow-hidden bg-white">
        <header className="titlebar-drag-region relative flex h-[50px] shrink-0 items-center justify-center">
          <span className="text-[13px] font-medium text-stone-400 tracking-wide">
            {isRunning ? "Zora is awakening..." : "Awakening"}
          </span>
          <div className="titlebar-no-drag absolute right-4 top-1/2 -translate-y-1/2">
            <Button variant="ghost" size="sm" onClick={handleSkip} className="text-stone-400 hover:text-stone-700">
              跳过
            </Button>
          </div>
        </header>

        <div className="titlebar-no-drag flex-1 overflow-y-auto px-5 py-5 sm:px-8">
          <MessageList />
        </div>

        <footer className="titlebar-no-drag bg-white px-6 py-4">
          <div className="mx-auto w-full max-w-4xl">
            <ChatInput onSubmit={handleSubmit} onStop={handleStop} />
          </div>
        </footer>
      </section>
    </main>
  );
}
