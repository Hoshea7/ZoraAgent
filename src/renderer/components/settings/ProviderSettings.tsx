import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  PROVIDER_PRESETS,
  type ProviderConfig,
  type ProviderCreateInput,
  type ProviderTestResult,
  type ProviderType,
  type ProviderUpdateInput,
} from "../../../shared/types/provider";
import { loadProvidersAtom, providersAtom } from "../../store/provider";
import { getErrorMessage } from "../../utils/message";
import { Button } from "../ui/Button";
import { VisibilityIcon } from "../ui/VisibilityIcon";

type FormMode =
  | { type: "create" }
  | { type: "edit"; providerId: string }
  | null;

interface ProviderFormState {
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

interface ConnectionTestState {
  status: "success" | "error";
  message: string;
}

const DEFAULT_PROVIDER_TYPE: ProviderType = "anthropic";
const MASKED_API_KEY_DISPLAY = "••••••••••••••••••••";
const inputClassName = [
  "w-full rounded-[10px] border border-stone-200 bg-white px-3.5 py-2.5 text-[14px] text-stone-900",
  "outline-none transition-all placeholder:text-stone-400",
  "focus:border-stone-400 focus:ring-4 focus:ring-stone-200/50 shadow-sm",
].join(" ");

function createEmptyFormState(): ProviderFormState {
  return {
    name: "",
    providerType: DEFAULT_PROVIDER_TYPE,
    baseUrl: PROVIDER_PRESETS[DEFAULT_PROVIDER_TYPE].defaultUrl,
    apiKey: "",
    modelId: "",
  };
}

function createEditFormState(provider: ProviderConfig): ProviderFormState {
  return {
    name: provider.name,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    apiKey: "",
    modelId: provider.modelId ?? "",
  };
}

function ProviderTypeBadge({ providerType }: { providerType: ProviderType }) {
  return (
    <span className="inline-flex items-center rounded-md bg-stone-100/80 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-stone-600 ring-1 ring-inset ring-stone-200/50">
      {PROVIDER_PRESETS[providerType].label}
    </span>
  );
}

export function ProviderSettings() {
  const providers = useAtomValue(providersAtom);
  const loadProviders = useSetAtom(loadProvidersAtom);

  const [formMode, setFormMode] = useState<FormMode>(null);
  const [formState, setFormState] = useState<ProviderFormState>(createEmptyFormState);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isLoadingApiKey, setIsLoadingApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [activeCardActionId, setActiveCardActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectionTestState, setConnectionTestState] = useState<ConnectionTestState | null>(null);

  const isEditing = formMode?.type === "edit";
  const isApiKeyLocked = isEditing && !showApiKey;
  const canTestConnection =
    formState.baseUrl.trim().length > 0 && formState.apiKey.trim().length > 0 && !isTestingConnection;

  const updateFormState = (
    updater:
      | Partial<ProviderFormState>
      | ((current: ProviderFormState) => ProviderFormState)
  ) => {
    setConnectionTestState(null);
    setFormState((current) =>
      typeof updater === "function" ? updater(current) : { ...current, ...updater }
    );
  };

  const openCreateForm = () => {
    setFormMode({ type: "create" });
    setFormState(createEmptyFormState());
    setShowApiKey(false);
    setErrorMessage(null);
    setConnectionTestState(null);
  };

  const openEditForm = (provider: ProviderConfig) => {
    setFormMode({ type: "edit", providerId: provider.id });
    setFormState(createEditFormState(provider));
    setShowApiKey(false);
    setErrorMessage(null);
    setConnectionTestState(null);
  };

  const closeForm = () => {
    setFormMode(null);
    setFormState(createEmptyFormState());
    setShowApiKey(false);
    setErrorMessage(null);
    setConnectionTestState(null);
  };

  const refreshProviders = async () => {
    await loadProviders();
  };

  const handleSave = async () => {
    const name = formState.name.trim();
    const baseUrl = formState.baseUrl.trim();
    const apiKey = formState.apiKey.trim();

    if (!name) {
      setErrorMessage("请填写 Provider 名称。");
      return;
    }

    if (!baseUrl) {
      setErrorMessage("请填写 Base URL。");
      return;
    }

    if (!isEditing && !apiKey) {
      setErrorMessage("请填写 API Key。");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      if (isEditing && formMode) {
        const payload: ProviderUpdateInput = {
          name,
          providerType: formState.providerType,
          baseUrl,
          modelId: formState.modelId,
        };

        if (apiKey) {
          payload.apiKey = apiKey;
        }

        await window.zora.updateProvider(formMode.providerId, payload);
      } else {
        const payload: ProviderCreateInput = {
          name,
          providerType: formState.providerType,
          baseUrl,
          apiKey,
          modelId: formState.modelId,
        };

        await window.zora.createProvider(payload);
      }

      await refreshProviders();
      closeForm();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (providerId: string) => {
    setActiveCardActionId(providerId);
    setErrorMessage(null);

    try {
      await window.zora.deleteProvider(providerId);
      await refreshProviders();

      if (formMode?.type === "edit" && formMode.providerId === providerId) {
        closeForm();
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setActiveCardActionId(null);
    }
  };

  const handleSetDefault = async (providerId: string) => {
    setActiveCardActionId(providerId);
    setErrorMessage(null);

    try {
      await window.zora.setDefaultProvider(providerId);
      await refreshProviders();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setActiveCardActionId(null);
    }
  };

  const handleTestConnection = async () => {
    if (!canTestConnection) {
      return;
    }

    if (typeof window.zora.testProvider !== "function") {
      setConnectionTestState({
        status: "error",
        message: "当前应用仍在使用旧的 preload，请重启 Electron 开发进程后再试。",
      });
      return;
    }

    setIsTestingConnection(true);
    setErrorMessage(null);
    setConnectionTestState(null);

    try {
      const result: ProviderTestResult = await window.zora.testProvider(
        formState.baseUrl.trim(),
        formState.apiKey.trim(),
        formState.modelId.trim() || undefined
      );

      setConnectionTestState({
        status: result.success ? "success" : "error",
        message: result.message,
      });
    } catch (error) {
      setConnectionTestState({
        status: "error",
        message: getErrorMessage(error),
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleToggleApiKeyVisibility = async () => {
    if (showApiKey) {
      setShowApiKey(false);
      return;
    }

    if (isEditing && formMode && formState.apiKey.trim().length === 0) {
      setIsLoadingApiKey(true);
      setErrorMessage(null);

      try {
        const currentApiKey = await window.zora.getProviderApiKey(formMode.providerId);

        if (!currentApiKey) {
          setErrorMessage("未能读取当前 API Key，请重新填写后保存。");
          return;
        }

        updateFormState({
          apiKey: currentApiKey,
        });
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
        return;
      } finally {
        setIsLoadingApiKey(false);
      }
    }

    setShowApiKey(true);
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 space-y-8 duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between pb-6 border-b border-stone-100">
        <div className="max-w-xl">
          <h2 className="text-[24px] font-semibold tracking-tight text-stone-900">
            模型配置
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-500">
            配置您的 Anthropic 或兼容协议模型端点。当前会话将使用选中的默认环境。
          </p>
        </div>

        <Button type="button" onClick={openCreateForm} className="shrink-0 shadow-sm" variant="primary">
          <span className="flex items-center gap-1.5">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            添加配置
          </span>
        </Button>
      </div>

      {providers.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-stone-200 bg-stone-50/50 px-6 py-16 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-stone-200/50">
            <svg className="h-6 w-6 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <h3 className="mt-5 text-[16px] font-medium text-stone-900">还没有配置任何 Provider</h3>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-stone-500">
            添加一个可用的模型服务。保存后它会自动成为默认配置并生效。
          </p>
          {!formMode ? (
            <Button type="button" onClick={openCreateForm} className="mt-6" variant="secondary">
              立即添加
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
          {providers.map((provider) => {
            const isCardBusy = activeCardActionId === provider.id;

            return (
              <article
                key={provider.id}
                className={[
                  "group relative flex flex-col justify-between overflow-hidden rounded-[16px] border bg-white p-5 transition-all duration-200",
                  provider.isDefault 
                    ? "border-stone-800 shadow-md ring-1 ring-stone-800/5" 
                    : "border-stone-200 shadow-sm hover:border-stone-300 hover:shadow-md"
                ].join(" ")}
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[16px] font-semibold tracking-tight text-stone-900">
                        {provider.name}
                      </h3>
                      {provider.isDefault && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-stone-900 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          当前使用
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-50 ring-1 ring-inset ring-stone-200/50">
                        <svg className="h-4 w-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-stone-400">Endpoint</p>
                        <p className="truncate text-[13px] text-stone-700">{provider.baseUrl}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-50 ring-1 ring-inset ring-stone-200/50">
                        <svg className="h-4 w-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-stone-400">Model</p>
                        <p className="truncate text-[13px] text-stone-700">
                          {provider.modelId || <span className="text-stone-400 italic">默认模型</span>}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between border-t border-stone-100 pt-4">
                  <ProviderTypeBadge providerType={provider.providerType} />
                  
                  <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 sm:opacity-100">
                    {!provider.isDefault && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={isCardBusy}
                        onClick={() => {
                          void handleSetDefault(provider.id);
                        }}
                        className="h-7 px-2.5 text-[12px]"
                      >
                        设为默认
                      </Button>
                    )}
                    <button
                      type="button"
                      disabled={isCardBusy}
                      onClick={() => openEditForm(provider)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50"
                      title="编辑"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      disabled={isCardBusy}
                      onClick={() => {
                        void handleDelete(provider.id);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                      title="删除"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {formMode ? (
        <div className="overflow-hidden rounded-[20px] border border-stone-200 bg-white shadow-xl ring-1 ring-black/5 animate-in slide-in-from-bottom-2 fade-in duration-300">
          <div className="border-b border-stone-100 bg-stone-50/50 px-6 py-4 flex items-center justify-between">
            <h3 className="text-[16px] font-semibold tracking-tight text-stone-900">
              {formMode.type === "edit" ? "编辑 Provider" : "新增 Provider 配置"}
            </h3>
            <button 
              onClick={closeForm}
              className="rounded-full p-1.5 text-stone-400 transition hover:bg-stone-200/50 hover:text-stone-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block sm:col-span-1">
                <span className="mb-1.5 block text-[13px] font-medium text-stone-700">配置名称</span>
                <input
                  className={inputClassName}
                  value={formState.name}
                  onChange={(event) =>
                    updateFormState({
                      name: event.target.value,
                    })
                  }
                  placeholder="例如：Anthropic 官方"
                />
              </label>

              <label className="block sm:col-span-1">
                <span className="mb-1.5 block text-[13px] font-medium text-stone-700">供应商类型</span>
                <select
                  className={inputClassName}
                  value={formState.providerType}
                  onChange={(event) => {
                    const nextType = event.target.value as ProviderType;
                    updateFormState((current) => ({
                      ...current,
                      providerType: nextType,
                      baseUrl: PROVIDER_PRESETS[nextType].defaultUrl,
                    }));
                  }}
                >
                  {Object.entries(PROVIDER_PRESETS).map(([providerType, preset]) => (
                    <option key={providerType} value={providerType}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[13px] font-medium text-stone-700">Base URL</span>
                <input
                  className={inputClassName}
                  value={formState.baseUrl}
                  onChange={(event) =>
                    updateFormState({
                      baseUrl: event.target.value,
                    })
                  }
                  placeholder="https://api.anthropic.com"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[13px] font-medium text-stone-700">API Key</span>
                <div className="relative">
                  <input
                    type={showApiKey ? "text" : "password"}
                    className={[
                      `${inputClassName} pr-10`,
                      isApiKeyLocked ? "pointer-events-none cursor-not-allowed select-none text-stone-500" : ""
                    ].join(" ")}
                    value={isApiKeyLocked ? MASKED_API_KEY_DISPLAY : formState.apiKey}
                    onChange={(event) =>
                      updateFormState({
                        apiKey: event.target.value,
                      })
                    }
                    placeholder={isEditing ? "" : "sk-..."}
                    readOnly={isApiKeyLocked}
                    tabIndex={isApiKeyLocked ? -1 : 0}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handleToggleApiKeyVisibility();
                    }}
                    disabled={isLoadingApiKey}
                    className="absolute inset-y-0 right-3 flex items-center text-stone-400 transition hover:text-stone-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isLoadingApiKey ? (
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    ) : (
                      <VisibilityIcon visible={showApiKey} />
                    )}
                  </button>
                </div>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[12px] text-stone-400">
                    使用当前表单中的 Base URL 和 API Key 进行真实连接验证。
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!canTestConnection || isSaving}
                    onClick={() => {
                      void handleTestConnection();
                    }}
                    className="min-w-[108px] justify-center"
                  >
                    {isTestingConnection ? (
                      <span className="flex items-center gap-2">
                        <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        测试中…
                      </span>
                    ) : (
                      "测试连接"
                    )}
                  </Button>
                </div>
                {connectionTestState ? (
                  <div
                    className={[
                      "mt-3 flex items-start gap-2.5 rounded-[10px] px-4 py-3 text-[13px] ring-1 ring-inset",
                      connectionTestState.status === "success"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-rose-50 text-rose-700 ring-rose-200"
                    ].join(" ")}
                  >
                    {connectionTestState.status === "success" ? (
                      <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    <p className="font-medium">{connectionTestState.message}</p>
                  </div>
                ) : null}
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[13px] font-medium text-stone-700">Model ID <span className="text-stone-400 font-normal">(可选)</span></span>
                <input
                  className={inputClassName}
                  value={formState.modelId}
                  onChange={(event) =>
                    updateFormState({
                      modelId: event.target.value,
                    })
                  }
                  placeholder="留空使用系统默认模型"
                />
              </label>
            </div>

            {errorMessage && (
              <div className="mt-5 flex items-start gap-2.5 rounded-[10px] bg-rose-50 px-4 py-3 text-[13px] text-rose-700 ring-1 ring-inset ring-rose-200">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="font-medium">{errorMessage}</p>
              </div>
            )}

            <div className="mt-8 flex items-center justify-end gap-3 pt-5 border-t border-stone-100">
              <Button type="button" variant="ghost" onClick={closeForm} disabled={isSaving}>
                取消
              </Button>
              <Button type="button" onClick={() => void handleSave()} disabled={isSaving} className="min-w-[80px]">
                {isSaving ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    保存中
                  </span>
                ) : (
                  "保存配置"
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
