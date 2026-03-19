import { useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { FeishuConfig } from "../../../shared/types/feishu";
import { feishuBridgeStatusAtom, feishuConfigAtom } from "../../store/feishu";
import { cn } from "../../utils/cn";
import { getErrorMessage } from "../../utils/message";
import { Button } from "../ui/Button";

interface ConnectionFeedback {
  status: "success" | "error";
  message: string;
  botName: string | null;
}

const inputClassName = [
  "w-full bg-transparent px-0 py-2 text-[14px] text-stone-900 text-right font-mono",
  "outline-none transition-all placeholder:text-stone-400 placeholder:font-sans",
].join(" ");

const runtimeStatusMeta = {
  stopped: {
    label: "未运行",
    dotClassName: "bg-stone-300",
    textClassName: "text-stone-500",
  },
  starting: {
    label: "连接中…",
    dotClassName: "bg-amber-500 animate-pulse",
    textClassName: "text-amber-600",
  },
  running: {
    label: "运行中",
    dotClassName: "bg-emerald-500",
    textClassName: "text-emerald-600",
  },
  error: {
    label: "错误",
    dotClassName: "bg-rose-500",
    textClassName: "text-rose-600",
  },
} as const;

function createEmptyConfig(): FeishuConfig {
  return {
    enabled: false,
    appId: "",
    appSecret: "",
    autoStart: false,
  };
}

function normalizeConfigForSave(config: FeishuConfig): FeishuConfig {
  const defaultWorkspaceId = config.defaultWorkspaceId?.trim();
  return {
    ...config,
    appId: config.appId.trim(),
    appSecret: config.appSecret.trim(),
    defaultWorkspaceId: defaultWorkspaceId ? defaultWorkspaceId : undefined,
  };
}

function isBaseConfigPersisted(formState: FeishuConfig, savedConfig: FeishuConfig | null): boolean {
  if (!savedConfig) return false;
  const normalizedForm = normalizeConfigForSave(formState);
  const normalizedSaved = normalizeConfigForSave(savedConfig);
  return (
    normalizedForm.appId === normalizedSaved.appId &&
    normalizedForm.appSecret === normalizedSaved.appSecret &&
    normalizedForm.autoStart === normalizedSaved.autoStart &&
    normalizedForm.defaultWorkspaceId === normalizedSaved.defaultWorkspaceId &&
    normalizedForm.enabled === normalizedSaved.enabled
  );
}

function getFeishuApi() {
  return window.zora.feishu;
}

export function FeishuSettings() {
  const savedConfig = useAtomValue(feishuConfigAtom);
  const setSavedConfig = useSetAtom(feishuConfigAtom);
  const [bridgeState, setBridgeState] = useAtom(feishuBridgeStatusAtom);

  const [formState, setFormState] = useState<FeishuConfig>(createEmptyConfig);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [connectionFeedback, setConnectionFeedback] = useState<ConnectionFeedback | null>(null);

  useEffect(() => {
    let isActive = true;
    const loadConfig = async () => {
      setIsLoadingConfig(true);
      setErrorMessage(null);
      try {
        const config = await getFeishuApi().getConfig();
        if (!isActive) return;
        setSavedConfig(config);
        setFormState(config ?? createEmptyConfig());
      } catch (error) {
        if (!isActive) return;
        setErrorMessage(getErrorMessage(error));
      } finally {
        if (isActive) setIsLoadingConfig(false);
      }
    };
    void loadConfig();
    return () => { isActive = false; };
  }, [setSavedConfig]);

  useEffect(() => {
    let isActive = true;
    let unsubscribe: (() => void) | null = null;
    const syncBridgeStatus = async () => {
      try {
        const api = getFeishuApi();
        const initialStatus = await api.getStatus();
        if (!isActive) return;
        setBridgeState(initialStatus);
        unsubscribe = api.onStatusChanged((status) => { setBridgeState(status); });
      } catch (error) {
        if (!isActive) return;
        setErrorMessage((current) => current ?? getErrorMessage(error));
      }
    };
    void syncBridgeStatus();
    return () => { isActive = false; unsubscribe?.(); };
  }, [setBridgeState]);

  const normalizedFormState = normalizeConfigForSave(formState);
  const hasRequiredCredentials = normalizedFormState.appId.length > 0 && normalizedFormState.appSecret.length > 0;
  const hasSavedCurrentConfig = isBaseConfigPersisted(formState, savedConfig);
  const canTestConnection = hasRequiredCredentials && !isTestingConnection && !isLoadingConfig;
  const canSaveConfig = hasRequiredCredentials && !isSaving && !isLoadingConfig;
  const canEnableBridge = formState.enabled || (hasRequiredCredentials && hasSavedCurrentConfig && (connectionFeedback?.status === "success" || savedConfig?.enabled === true));
  const canStartBridge = bridgeState.status !== "starting" && bridgeState.status !== "running" && savedConfig?.enabled === true && Boolean(savedConfig.appId) && Boolean(savedConfig.appSecret);
  const canStopBridge = bridgeState.status === "running";
  const bridgeStatusDisplay = runtimeStatusMeta[bridgeState.status];

  const updateFormState = (updates: Partial<FeishuConfig>, options?: { resetFeedback?: boolean }) => {
    if (options?.resetFeedback) {
      setConnectionFeedback(null);
      setSavedMessage(null);
    }
    setErrorMessage(null);
    setFormState((current) => ({ ...current, ...updates }));
  };

  const persistConfig = async (nextConfig: FeishuConfig, successMessage: string) => {
    const saved = await getFeishuApi().saveConfig(normalizeConfigForSave(nextConfig));
    setSavedConfig(saved);
    setFormState(saved);
    setSavedMessage(successMessage);
    setErrorMessage(null);
    return saved;
  };

  const handleSave = async () => {
    if (!hasRequiredCredentials) {
      setErrorMessage("请填写 App ID 和 App Secret");
      return;
    }
    setIsSaving(true);
    setSavedMessage(null);
    try {
      await persistConfig(formState, "配置已保存");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!canTestConnection) return;
    setIsTestingConnection(true);
    setSavedMessage(null);
    setErrorMessage(null);
    setConnectionFeedback(null);
    try {
      const result = await getFeishuApi().testConnection({ appId: normalizedFormState.appId, appSecret: normalizedFormState.appSecret });
      if (result.success) {
        setConnectionFeedback({ status: "success", botName: result.botName, message: result.botName ? `已连接: ${result.botName}` : "验证通过" });
      } else {
        setConnectionFeedback({ status: "error", botName: null, message: result.error ?? "连接失败" });
      }
    } catch (error) {
      setConnectionFeedback({ status: "error", botName: null, message: getErrorMessage(error) });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!canEnableBridge) {
      setErrorMessage("请先保存配置并测试连接");
      return;
    }
    setIsTogglingEnabled(true);
    setSavedMessage(null);
    try {
      await persistConfig({ ...formState, enabled: !formState.enabled }, formState.enabled ? "已关闭" : "已启用");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsTogglingEnabled(false);
    }
  };

  const handleStartBridge = async () => {
    setSavedMessage(null);
    setErrorMessage(null);
    try { await getFeishuApi().startBridge(); } catch (error) { setErrorMessage(getErrorMessage(error)); }
  };

  const handleStopBridge = async () => {
    setSavedMessage(null);
    setErrorMessage(null);
    try { await getFeishuApi().stopBridge(); } catch (error) { setErrorMessage(getErrorMessage(error)); }
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 mx-auto max-w-3xl space-y-6 pb-10 duration-500">
      <div className="flex flex-col gap-1.5 border-b border-stone-100 pb-5">
        <h2 className="text-[24px] font-semibold tracking-tight text-stone-900">飞书 Bridge</h2>
        <p className="text-[14px] leading-relaxed text-stone-500">
          通过连接飞书开放平台，将飞书消息转入 ZoraAgent。凭证安全存储于本地。
        </p>
      </div>

      <div className="space-y-5">
        {/* 服务状态组 */}
        <div>
          <h3 className="mb-2 ml-1 text-[12px] font-medium uppercase tracking-[0.08em] text-stone-500">服务状态</h3>
          <div className="overflow-hidden rounded-[14px] border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex flex-col">
                <span className="text-[15px] font-medium text-stone-900">启用飞书 Bridge</span>
                <span className="mt-0.5 text-[12px] text-stone-500">控制应用是否允许连接飞书</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={formState.enabled}
                disabled={isTogglingEnabled || !canEnableBridge}
                onClick={() => void handleToggleEnabled()}
                className={cn(
                  "relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
                  formState.enabled ? "bg-stone-900" : "bg-stone-200",
                  (!canEnableBridge || isTogglingEnabled) && "opacity-50 cursor-not-allowed"
                )}
              >
                <span className={cn(
                  "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                  formState.enabled ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>
            
            <div className="ml-4 h-px bg-stone-100" />
            
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-medium text-stone-900">运行状态</span>
                  <div className="flex items-center gap-1.5 ml-2">
                    <span className={cn("h-2 w-2 rounded-full", bridgeStatusDisplay.dotClassName)} />
                    <span className={cn("text-[12px] font-medium", bridgeStatusDisplay.textClassName)}>
                      {bridgeStatusDisplay.label}
                    </span>
                  </div>
                </div>
                {bridgeState.botName && bridgeState.status === "running" && (
                  <span className="mt-0.5 text-[12px] text-stone-500">当前 Bot: {bridgeState.botName}</span>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                {bridgeState.status === "running" ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => void handleStopBridge()} disabled={!canStopBridge} className="min-w-[64px] border-transparent bg-stone-100 px-3 py-1.5 text-[12px] text-stone-900 hover:bg-stone-200">
                    停止
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={() => void handleStartBridge()} disabled={!canStartBridge || bridgeState.status === "starting"} className="min-w-[64px] px-3 py-1.5 text-[12px]">
                    {bridgeState.status === "starting" ? "连接中" : "启动"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 凭证配置组 */}
        <div>
          <h3 className="mb-2 ml-1 flex items-center justify-between text-[12px] font-medium uppercase tracking-[0.08em] text-stone-500">
            <span>应用凭证</span>
            {isLoadingConfig && <span className="lowercase normal-case text-stone-400">读取中...</span>}
          </h3>
          <div className="overflow-hidden rounded-[14px] border border-stone-200 bg-white shadow-sm">
            <div className="group flex items-center px-4 py-3">
              <span className="w-24 whitespace-nowrap text-[15px] text-stone-900">App ID</span>
              <input
                className={inputClassName}
                value={formState.appId}
                onChange={(e) => updateFormState({ appId: e.target.value }, { resetFeedback: true })}
                placeholder="cli_a1b2c3d4..."
              />
            </div>
            <div className="ml-4 h-px bg-stone-100" />
            <div className="group relative flex items-center px-4 py-3">
              <span className="w-28 whitespace-nowrap text-[15px] text-stone-900">App Secret</span>
              <input
                type="password"
                className={cn(inputClassName, "tracking-widest")}
                value={formState.appSecret}
                onChange={(e) => updateFormState({ appSecret: e.target.value }, { resetFeedback: true })}
                placeholder="Required"
              />
            </div>
            
            {/* Actions Footer inside the card */}
            <div className="flex items-center justify-between border-t border-stone-100 bg-stone-50/50 px-4 py-3.5">
              <div className="flex items-center gap-3">
                {connectionFeedback ? (
                  <span className={cn(
                    "flex items-center gap-1.5 text-[12px]",
                    connectionFeedback.status === "success" ? "text-emerald-600" : "text-rose-600"
                  )}>
                    {connectionFeedback.status === "success" ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    )}
                    {connectionFeedback.message}
                  </span>
                ) : (
                  <span className="text-[12px] text-stone-500">安全保存在本地</span>
                )}
              </div>
              
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => void handleTestConnection()} disabled={!canTestConnection || isSaving} className="bg-white px-3 py-1.5 text-[12px] hover:bg-stone-50">
                  {isTestingConnection ? "测试中…" : "测试连接"}
                </Button>
                <Button type="button" size="sm" onClick={() => void handleSave()} disabled={!canSaveConfig || hasSavedCurrentConfig} className="px-3 py-1.5 text-[12px]">
                  {isSaving ? "保存中" : hasSavedCurrentConfig ? "已保存" : "保存"}
                </Button>
              </div>
            </div>
          </div>
        </div>

      </div>

      {(savedMessage || errorMessage) && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in">
          <div className={cn(
            "flex items-center gap-2.5 rounded-full px-5 py-3 shadow-lg ring-1 text-[14px] font-medium backdrop-blur-md",
            savedMessage ? "bg-emerald-500/90 text-white ring-emerald-600/20" : "bg-rose-500/90 text-white ring-rose-600/20"
          )}>
            {savedMessage ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            )}
            {savedMessage || errorMessage}
          </div>
        </div>
      )}
    </section>
  );
}
