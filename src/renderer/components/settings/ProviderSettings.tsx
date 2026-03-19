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
import { cn } from "../../utils/cn";

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
  "w-full bg-transparent px-0 py-2 text-[14px] text-stone-900 font-mono",
  "outline-none transition-all placeholder:text-stone-400 placeholder:font-sans",
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
    <span className="inline-flex items-center rounded bg-stone-100/80 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-stone-500">
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
      setErrorMessage("请填写配置名称");
      return;
    }

    if (!baseUrl) {
      setErrorMessage("请填写 Base URL");
      return;
    }

    if (!isEditing && !apiKey) {
      setErrorMessage("请填写 API Key");
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
        message: "当前应用仍在使用旧的 preload，请重启后再试",
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
          setErrorMessage("未能读取当前 API Key");
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
    <section className="animate-in fade-in slide-in-from-bottom-4 mx-auto max-w-3xl space-y-6 pb-10 duration-500">
      <div className="flex flex-col gap-1.5 border-b border-stone-100 pb-5">
        <h2 className="text-[24px] font-semibold tracking-tight text-stone-900">
          模型配置
        </h2>
        <p className="text-[14px] leading-relaxed text-stone-500">
          配置并管理兼容 Anthropic 协议的大语言模型服务节点。
        </p>
      </div>

      <div className="grid gap-5">
        <div className="flex items-center justify-between">
          <h3 className="ml-1 text-[12px] font-medium uppercase tracking-[0.08em] text-stone-500">
            已添加的配置
          </h3>
          <Button type="button" onClick={openCreateForm} size="sm" className="rounded-full bg-stone-900 px-3.5 py-1.5 text-[12.5px] text-white hover:bg-stone-800">
            <span className="flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              添加配置
            </span>
          </Button>
        </div>

        {providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[18px] border border-dashed border-stone-200 bg-stone-50/50 px-6 py-10 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-stone-200/50">
              <svg className="h-5 w-5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <h3 className="text-[15px] font-medium text-stone-900">暂无模型配置</h3>
            <p className="mt-1 max-w-sm text-[13px] text-stone-500">
              添加一个可用的模型服务端点即可开始使用。
            </p>
          </div>
        ) : (
          <div className="flex flex-col overflow-hidden rounded-[14px] border border-stone-200 bg-white shadow-sm">
            {providers.map((provider, index) => {
              const isCardBusy = activeCardActionId === provider.id;

              return (
                <div key={provider.id} className="flex flex-col">
                  {index > 0 && <div className="ml-4 h-px bg-stone-100" />}
                  
                  <div className={cn(
                    "group relative flex items-center justify-between px-4 py-3.5 transition-all duration-200 hover:bg-stone-50/50",
                    provider.isDefault && "bg-emerald-50/30"
                  )}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      
                      {provider.isDefault ? (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                          <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-400">
                          <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                          </svg>
                        </div>
                      )}

                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "truncate text-[15px] font-medium tracking-tight",
                            provider.isDefault ? "text-emerald-900" : "text-stone-900"
                          )}>
                            {provider.name}
                          </span>
                          <ProviderTypeBadge providerType={provider.providerType} />
                        </div>
                        
                        <div className="flex items-center gap-2 text-[12px] text-stone-500">
                          <span className="truncate max-w-[200px] font-mono" title={provider.baseUrl}>
                            {provider.baseUrl.replace(/^https?:\/\//, '')}
                          </span>
                          <span className="text-stone-300">•</span>
                          <span className="truncate max-w-[120px] font-mono" title={provider.modelId || "默认"}>
                            {provider.modelId || "默认模型"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 pl-3">
                      {!provider.isDefault && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isCardBusy}
                          onClick={() => void handleSetDefault(provider.id)}
                          className="mr-1.5 h-7 px-2.5 text-[12px] text-stone-500 opacity-0 transition-opacity hover:text-stone-900 group-hover:opacity-100 focus-within:opacity-100"
                        >
                          设为默认
                        </Button>
                      )}
                      <button
                        type="button"
                        disabled={isCardBusy}
                        onClick={() => openEditForm(provider)}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-200/50 hover:text-stone-900 disabled:opacity-50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={isCardBusy || provider.isDefault}
                        onClick={() => void handleDelete(provider.id)}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30",
                          provider.isDefault && "cursor-not-allowed"
                        )}
                        title={provider.isDefault ? "默认配置不能删除" : "删除"}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {formMode ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-stone-900/20 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg overflow-hidden rounded-[20px] bg-white shadow-2xl ring-1 ring-black/5 animate-in zoom-in-95 duration-200 slide-in-from-bottom-4">
            <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5">
              <h3 className="text-[16px] font-semibold tracking-tight text-stone-900">
                {formMode.type === "edit" ? "编辑配置" : "新增配置"}
              </h3>
              <button 
                onClick={closeForm}
                className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-900"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-2">
              <div className="m-3 overflow-hidden rounded-[14px] border border-stone-100 bg-white shadow-sm">
                
                <div className="group flex items-center px-4 py-2.5">
                  <span className="w-24 whitespace-nowrap text-[14px] text-stone-900">名称</span>
                  <input
                    className={cn(inputClassName, "text-right")}
                    value={formState.name}
                    onChange={(e) => updateFormState({ name: e.target.value })}
                    placeholder="我的模型"
                  />
                </div>
                
                <div className="ml-4 h-px bg-stone-100" />
                
                <div className="group flex items-center px-4 py-2.5">
                  <span className="w-24 whitespace-nowrap text-[14px] text-stone-900">供应商</span>
                  <select
                    className={cn(inputClassName, "text-right appearance-none cursor-pointer")}
                    value={formState.providerType}
                    onChange={(e) => {
                      const nextType = e.target.value as ProviderType;
                      updateFormState((c) => ({ ...c, providerType: nextType, baseUrl: PROVIDER_PRESETS[nextType].defaultUrl }));
                    }}
                  >
                    {Object.entries(PROVIDER_PRESETS).map(([providerType, preset]) => (
                      <option key={providerType} value={providerType}>{preset.label}</option>
                    ))}
                  </select>
                </div>
                
                <div className="ml-4 h-px bg-stone-100" />
                
                <div className="group flex items-center px-4 py-2.5">
                  <span className="w-24 whitespace-nowrap text-[14px] text-stone-900">Base URL</span>
                  <input
                    className={cn(inputClassName, "text-right")}
                    value={formState.baseUrl}
                    onChange={(e) => updateFormState({ baseUrl: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
                
                <div className="ml-4 h-px bg-stone-100" />
                
                <div className="group relative flex items-center px-4 py-2.5">
                  <span className="w-24 whitespace-nowrap text-[14px] text-stone-900">API Key</span>
                  <div className="flex-1 flex items-center justify-end">
                    <input
                      type={showApiKey ? "text" : "password"}
                      className={cn(
                        inputClassName, 
                        "text-right pr-2 tracking-widest flex-1 min-w-0",
                        isApiKeyLocked && "text-stone-400"
                      )}
                      value={isApiKeyLocked ? MASKED_API_KEY_DISPLAY : formState.apiKey}
                      onChange={(e) => updateFormState({ apiKey: e.target.value })}
                      placeholder={isEditing ? "点击图标查看/修改" : "sk-..."}
                      readOnly={isApiKeyLocked}
                      tabIndex={isApiKeyLocked ? -1 : 0}
                    />
                    <button
                      type="button"
                      onClick={() => void handleToggleApiKeyVisibility()}
                      disabled={isLoadingApiKey}
                      className="flex-shrink-0 flex items-center justify-center h-6 w-6 text-stone-400 hover:text-stone-700 disabled:opacity-50"
                    >
                      {isLoadingApiKey ? (
                        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      ) : showApiKey ? (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.543 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="ml-4 h-px bg-stone-100" />
                
                <div className="flex items-center px-5 py-3 group">
                  <span className="text-[15px] text-stone-900 whitespace-nowrap w-24">Model ID</span>
                  <input
                    className={cn(inputClassName, "text-right")}
                    value={formState.modelId}
                    onChange={(e) => updateFormState({ modelId: e.target.value })}
                    placeholder="留空使用默认"
                  />
                </div>
              </div>

              {connectionTestState && (
                <div className="mx-4 mb-4 flex items-start gap-2.5 rounded-[12px] px-4 py-3 text-[13px] ring-1 ring-inset bg-white shadow-sm border border-stone-100">
                  <span className={cn("mt-0.5", connectionTestState.status === "success" ? "text-emerald-500" : "text-rose-500")}>
                    {connectionTestState.status === "success" ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    )}
                  </span>
                  <p className="font-medium text-stone-700">{connectionTestState.message}</p>
                </div>
              )}

              {errorMessage && (
                <div className="mx-4 mb-4 flex items-start gap-2.5 rounded-[12px] bg-rose-50 px-4 py-3 text-[13px] text-rose-700 ring-1 ring-inset ring-rose-200">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <p className="font-medium">{errorMessage}</p>
                </div>
              )}

              <div className="flex items-center justify-between p-4 px-6 border-t border-stone-100 bg-stone-50/50 rounded-b-[24px]">
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => void handleTestConnection()} 
                  disabled={!canTestConnection || isSaving}
                  className="bg-white hover:bg-stone-50"
                >
                  {isTestingConnection ? "测试中…" : "测试连接"}
                </Button>
                
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={closeForm} disabled={isSaving}>取消</Button>
                  <Button type="button" onClick={() => void handleSave()} disabled={isSaving} className="min-w-[80px]">
                    {isSaving ? "保存中" : "保存"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
