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

interface StatusFeedbackItem {
  key: string;
  tone: "success" | "error";
  message: string;
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
  const [isLaunchingBridge, setIsLaunchingBridge] = useState(false);
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
  const canStartBridge =
    bridgeState.status !== "starting" &&
    bridgeState.status !== "running" &&
    hasRequiredCredentials &&
    !isLoadingConfig &&
    !isSaving &&
    !isLaunchingBridge;
  const canStopBridge = bridgeState.status === "running" && !isLaunchingBridge;
  const bridgeStatusDisplay = runtimeStatusMeta[bridgeState.status];
  const feedbackItems: StatusFeedbackItem[] = [];

  if (errorMessage) {
    feedbackItems.push({
      key: "error-message",
      tone: "error",
      message: errorMessage,
    });
  }

  if (bridgeState.error && bridgeState.error !== errorMessage) {
    feedbackItems.push({
      key: "bridge-error",
      tone: "error",
      message: bridgeState.error,
    });
  }

  if (connectionFeedback) {
    feedbackItems.push({
      key: "connection-feedback",
      tone: connectionFeedback.status,
      message: connectionFeedback.message,
    });
  }

  if (savedMessage) {
    feedbackItems.push({
      key: "saved-message",
      tone: "success",
      message: savedMessage,
    });
  }

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

  const handleStartBridge = async () => {
    if (!hasRequiredCredentials) {
      setErrorMessage("请先填写 App ID 和 App Secret。");
      return;
    }

    setIsLaunchingBridge(true);
    setSavedMessage(null);
    setErrorMessage(null);
    try {
      const nextConfig: FeishuConfig = {
        ...normalizedFormState,
        enabled: true,
      };

      // Save first so one-click start also works against an older main/preload process
      // that still expects `enabled === true` in persisted config.
      const persistedConfig = await getFeishuApi().saveConfig(nextConfig);
      setSavedConfig(persistedConfig);
      setFormState(persistedConfig);

      const startedConfig = await getFeishuApi().startBridge(persistedConfig);
      setSavedConfig(startedConfig);
      setFormState(startedConfig);
      setSavedMessage("已启动飞书 Bridge");
    } catch (error) {
      try {
        const latestConfig = await getFeishuApi().getConfig();
        setSavedConfig(latestConfig);
        setFormState(latestConfig ?? createEmptyConfig());
      } catch {
        // Ignore config refresh errors and keep the original start error visible.
      }
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLaunchingBridge(false);
    }
  };

  const handleStopBridge = async () => {
    setSavedMessage(null);
    setErrorMessage(null);
    try {
      await getFeishuApi().stopBridge();
      setSavedMessage("已停止飞书 Bridge");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 w-full pb-12 duration-500">
      {/* 状态栏 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", bridgeStatusDisplay.dotClassName)} />
          <span className={cn("text-[13px] font-medium", bridgeStatusDisplay.textClassName)}>
            {bridgeStatusDisplay.label}
          </span>
          {bridgeState.botName && bridgeState.status === "running" && (
            <span className="text-[12px] text-stone-400">· {bridgeState.botName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {bridgeState.status === "running" ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleStopBridge()} disabled={!canStopBridge} className="h-7 px-3 text-[12px]">
              停止
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => void handleStartBridge()} disabled={!canStartBridge || bridgeState.status === "starting"} className="h-7 px-3 text-[12px]">
              {bridgeState.status === "starting" || isLaunchingBridge ? "启动中" : "启动 Bridge"}
            </Button>
          )}
        </div>
      </div>

      {/* 凭证表单 */}
      <div className="overflow-hidden rounded-lg border border-stone-200/60 bg-white">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span className="w-20 shrink-0 text-[13px] text-stone-500">App ID</span>
          <input
            className={inputClassName}
            value={formState.appId}
            onChange={(e) => updateFormState({ appId: e.target.value }, { resetFeedback: true })}
            placeholder="cli_a1b2c3d4..."
          />
        </div>
        <div className="h-px bg-stone-100/60 mx-4" />
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span className="w-20 shrink-0 text-[13px] text-stone-500">App Secret</span>
          <input
            type="password"
            className={cn(inputClassName, "tracking-widest")}
            value={formState.appSecret}
            onChange={(e) => updateFormState({ appSecret: e.target.value }, { resetFeedback: true })}
            placeholder="必填"
          />
        </div>
      </div>

      {/* 操作栏 */}
      <div className="mt-4 flex items-center justify-between">
        <div className="min-h-[18px] space-y-1">
          {feedbackItems.map((item) => (
            <div
              key={item.key}
              className={cn(
                "flex items-center gap-1.5 text-[12px]",
                item.tone === "success" ? "text-emerald-600" : "text-rose-600"
              )}
            >
              {item.tone === "success" ? (
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              <span>{item.message}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => void handleTestConnection()} disabled={!canTestConnection || isSaving} className="h-7 px-3 text-[12px]">
            {isTestingConnection ? "测试中…" : "测试连接"}
          </Button>
          <Button type="button" size="sm" onClick={() => void handleSave()} disabled={!canSaveConfig || hasSavedCurrentConfig} className="h-7 px-3 text-[12px]">
            {isSaving ? "保存中" : hasSavedCurrentConfig ? "已保存" : "保存"}
          </Button>
        </div>
      </div>
    </section>
  );
}
