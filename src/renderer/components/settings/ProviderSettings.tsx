import { useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  PROVIDER_PRESETS,
  type ProviderConfig,
  type ProviderCreateInput,
  type ProviderTestRoleKey,
  type RoleModels,
  type RoleTestDetail,
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

type ValidationField = "name" | "baseUrl" | "apiKey";
type FieldErrors = Partial<Record<ValidationField, string>>;

interface ProviderFormState {
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  sonnetModel: string;
  opusModel: string;
  haikuModel: string;
  smallFastModel: string;
}

type RoleModelField = keyof Pick<
  ProviderFormState,
  "sonnetModel" | "opusModel" | "haikuModel" | "smallFastModel"
>;
type TestedFieldKey = "modelId" | RoleModelField;

interface ConnectionTestState {
  status: "success" | "error" | "info";
  message: string;
  details?: RoleTestDetail[] | null;
}

const DEFAULT_PROVIDER_TYPE: ProviderType = "anthropic";
const MASKED_API_KEY_DISPLAY = "••••••••••••••••••••";
const inputClassName = [
  "w-full border-0 border-b border-stone-200 bg-transparent px-0 py-2.5 text-[14px] text-stone-900",
  "outline-none transition-colors placeholder:text-stone-400",
  "focus:border-stone-500 focus:ring-0",
  "disabled:cursor-not-allowed disabled:opacity-60",
].join(" ");
const technicalInputClassName = cn(
  inputClassName,
  "font-mono text-[13.5px] tracking-tight"
);
const VALIDATION_FIELD_ORDER: ValidationField[] = ["name", "baseUrl", "apiKey"];
const DIALOG_TITLE_ID = "provider-settings-dialog-title";
const ROLE_MODEL_FIELDS: Array<{
  field: RoleModelField;
  role: Exclude<ProviderTestRoleKey, "main">;
  label: string;
}> = [
  { field: "sonnetModel", role: "sonnet", label: "Sonnet (探索/搜索)" },
  { field: "opusModel", role: "opus", label: "Opus (规划/深度思考)" },
  { field: "haikuModel", role: "haiku", label: "Haiku (快速/轻量)" },
  { field: "smallFastModel", role: "small", label: "Small (压缩/摘要)" },
];

function findRoleTestDetail(
  details: RoleTestDetail[] | null | undefined,
  role: ProviderTestRoleKey
): RoleTestDetail | undefined {
  return details?.find((detail) => detail.role === role);
}

function buildRoleModelsPayload(formState: ProviderFormState): RoleModels | undefined {
  const roleModels: RoleModels = {};

  for (const { field } of ROLE_MODEL_FIELDS) {
    const modelId = formState[field].trim();
    if (modelId) {
      roleModels[field] = modelId;
    }
  }

  return Object.keys(roleModels).length > 0 ? roleModels : undefined;
}

function getFailingConfiguredRoles(
  formState: ProviderFormState,
  details: RoleTestDetail[] | null | undefined
): string[] {
  const failingRoles: string[] = [];
  const mainModelId = formState.modelId.trim();
  const mainDetail = findRoleTestDetail(details, "main");

  if (mainModelId && mainDetail && !mainDetail.success) {
    failingRoles.push("主模型");
  }

  for (const { field, role, label } of ROLE_MODEL_FIELDS) {
    if (!formState[field].trim()) {
      continue;
    }

    const detail = findRoleTestDetail(details, role);
    if (detail && !detail.success) {
      failingRoles.push(label);
    }
  }

  return failingRoles;
}

function collectTestingFieldKeys(formState: ProviderFormState): TestedFieldKey[] {
  const fields: TestedFieldKey[] = [];

  if (formState.modelId.trim()) {
    fields.push("modelId");
  }

  for (const { field } of ROLE_MODEL_FIELDS) {
    if (formState[field].trim()) {
      fields.push(field);
    }
  }

  return fields;
}

function summarizeConnectionTest(
  connectionTestState: ConnectionTestState | null
): { tone: "success" | "error" | "info"; message: string } | null {
  if (!connectionTestState) {
    return null;
  }

  const details = connectionTestState.details;
  if (!details || details.length === 0) {
    return {
      tone:
        connectionTestState.status === "success"
          ? "success"
          : connectionTestState.status === "info"
            ? "info"
            : "error",
      message: connectionTestState.message,
    };
  }

  const resultsByModelId = new Map<string, boolean>();
  for (const detail of details) {
    resultsByModelId.set(detail.modelId, detail.success);
  }

  const totalCount = resultsByModelId.size;
  const successCount = Array.from(resultsByModelId.values()).filter(Boolean).length;
  const failCount = totalCount - successCount;

  if (failCount === 0) {
    return {
      tone: "success",
      message: `共测试 ${totalCount} 个模型，全部连接成功`,
    };
  }

  if (successCount === 0) {
    return {
      tone: "error",
      message: `${failCount} / ${totalCount} 个模型连接失败`,
    };
  }

  return {
    tone: "success",
    message: `${successCount} 个模型连接成功，${failCount} 个模型连接失败`,
  };
}

function FormRow({
  label,
  children,
  isLast = false,
  vertical = false,
  required = false,
  helperText,
  helperTextId,
  error = false,
}: {
  label: string;
  children: React.ReactNode;
  isLast?: boolean;
  vertical?: boolean;
  required?: boolean;
  helperText?: string;
  helperTextId?: string;
  error?: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "group py-3",
          vertical
            ? "flex flex-col gap-2"
            : "grid gap-2.5 sm:grid-cols-[92px_minmax(0,1fr)] sm:items-center sm:gap-5"
        )}
      >
        <span
          className={cn(
            "text-[12px] font-medium tracking-[0.02em] text-stone-500",
            !vertical && "whitespace-nowrap"
          )}
        >
          {label}
          {required ? <span className="ml-1 text-rose-500">*</span> : null}
        </span>
        <div className={cn("min-w-0", vertical && "w-full")}>
          {children}
          {helperText ? (
            <p
              id={helperTextId}
              className={cn(
                "pt-1 text-[11px] leading-relaxed",
                error ? "text-rose-600" : "text-stone-400"
              )}
            >
              {helperText}
            </p>
          ) : null}
        </div>
      </div>
      {!isLast && <div className="h-px bg-stone-100" />}
    </>
  );
}

function createEmptyFormState(): ProviderFormState {
  return {
    name: "",
    providerType: DEFAULT_PROVIDER_TYPE,
    baseUrl: PROVIDER_PRESETS[DEFAULT_PROVIDER_TYPE].defaultUrl,
    apiKey: "",
    modelId: "",
    sonnetModel: "",
    opusModel: "",
    haikuModel: "",
    smallFastModel: "",
  };
}

function createEditFormState(provider: ProviderConfig): ProviderFormState {
  return {
    name: provider.name,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    apiKey: "",
    modelId: provider.modelId ?? "",
    sonnetModel: provider.roleModels?.sonnetModel ?? "",
    opusModel: provider.roleModels?.opusModel ?? "",
    haikuModel: provider.roleModels?.haikuModel ?? "",
    smallFastModel: provider.roleModels?.smallFastModel ?? "",
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
  const [showRoleModels, setShowRoleModels] = useState(false);
  const [activeCardActionId, setActiveCardActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [connectionTestState, setConnectionTestState] = useState<ConnectionTestState | null>(null);
  const [testingFieldKeys, setTestingFieldKeys] = useState<TestedFieldKey[]>([]);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const baseUrlInputRef = useRef<HTMLInputElement | null>(null);
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null);
  const activeTestRunIdRef = useRef<string | null>(null);
  const testStatusTimeoutRef = useRef<number | null>(null);

  const isEditing = formMode?.type === "edit";
  const isApiKeyLocked = isEditing && !showApiKey;
  const isFormBusy = isSaving || isTestingConnection || isLoadingApiKey;
  const canTestConnection =
    formState.baseUrl.trim().length > 0 &&
    (isEditing || formState.apiKey.trim().length > 0) &&
    !isTestingConnection &&
    !isLoadingApiKey;

  const clearTransientTestStatus = () => {
    if (testStatusTimeoutRef.current !== null) {
      window.clearTimeout(testStatusTimeoutRef.current);
      testStatusTimeoutRef.current = null;
    }
  };

  const clearTestingUiState = () => {
    activeTestRunIdRef.current = null;
    setIsTestingConnection(false);
    setTestingFieldKeys([]);
  };

  const showStoppedTestMessage = () => {
    clearTransientTestStatus();
    setConnectionTestState({
      status: "info",
      message: "测试已停止",
      details: null,
    });
    testStatusTimeoutRef.current = window.setTimeout(() => {
      setConnectionTestState((current) =>
        current?.status === "info" && current.message === "测试已停止" ? null : current
      );
      testStatusTimeoutRef.current = null;
    }, 3000);
  };

  const updateFormState = (
    updater:
      | Partial<ProviderFormState>
      | ((current: ProviderFormState) => ProviderFormState)
  ) => {
    clearTransientTestStatus();
    setConnectionTestState(null);
    setFieldErrors({});
    setErrorMessage(null);
    setFormState((current) =>
      typeof updater === "function" ? updater(current) : { ...current, ...updater }
    );
  };

  const updateField = <K extends keyof ProviderFormState>(
    field: K,
    value: ProviderFormState[K]
  ) => {
    clearTransientTestStatus();
    if (field !== "name") {
      setConnectionTestState(null);
    }
    setErrorMessage(null);

    if (field === "name" || field === "baseUrl" || field === "apiKey") {
      const validationField = field as ValidationField;
      setFieldErrors((current) => {
        if (!current[validationField]) {
          return current;
        }

        const next = { ...current };
        delete next[validationField];
        return next;
      });
    }

    setFormState((current) => ({ ...current, [field]: value }));
  };

  const openCreateForm = () => {
    clearTransientTestStatus();
    setFormMode({ type: "create" });
    setFormState(createEmptyFormState());
    setShowApiKey(false);
    setShowRoleModels(false);
    setErrorMessage(null);
    setFieldErrors({});
    setConnectionTestState(null);
    setTestingFieldKeys([]);
  };

  const openEditForm = (provider: ProviderConfig) => {
    clearTransientTestStatus();
    setFormMode({ type: "edit", providerId: provider.id });
    setFormState(createEditFormState(provider));
    setShowApiKey(false);
    setShowRoleModels(false);
    setErrorMessage(null);
    setFieldErrors({});
    setConnectionTestState(null);
    setTestingFieldKeys([]);
  };

  const closeForm = () => {
    clearTransientTestStatus();
    setFormMode(null);
    setFormState(createEmptyFormState());
    setShowApiKey(false);
    setShowRoleModels(false);
    setErrorMessage(null);
    setFieldErrors({});
    setConnectionTestState(null);
    setTestingFieldKeys([]);
  };

  useEffect(() => {
    if (!formMode) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [formMode]);

  useEffect(() => {
    return () => {
      clearTransientTestStatus();
    };
  }, []);

  useEffect(() => {
    if (!formMode) {
      return;
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isFormBusy) {
        return;
      }

      event.preventDefault();
      closeForm();
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [formMode, isFormBusy]);

  const refreshProviders = async () => {
    await loadProviders();
  };

  const focusField = (field: ValidationField) => {
    const target =
      field === "name"
        ? nameInputRef.current
        : field === "baseUrl"
          ? baseUrlInputRef.current
          : apiKeyInputRef.current;

    if (!target) {
      return;
    }

    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  };

  const setValidationError = (field: ValidationField, message: string) => {
    clearTransientTestStatus();
    setConnectionTestState(null);
    setFieldErrors((current) => ({ ...current, [field]: message }));
    setErrorMessage(message);
    window.requestAnimationFrame(() => {
      focusField(field);
    });
  };

  const validateForm = () => {
    const nextErrors: FieldErrors = {};

    if (!formState.name.trim()) {
      nextErrors.name = "请填写配置名称";
    }

    if (!formState.baseUrl.trim()) {
      nextErrors.baseUrl = "请填写 Base URL";
    }

    if (!isEditing && !formState.apiKey.trim()) {
      nextErrors.apiKey = "请填写 API Key";
    }

    const missingCount = Object.keys(nextErrors).length;
    if (missingCount === 0) {
      setFieldErrors({});
      return true;
    }

    setConnectionTestState(null);
    setFieldErrors(nextErrors);

    const firstInvalidField = VALIDATION_FIELD_ORDER.find((field) => nextErrors[field]);
    setErrorMessage(
      missingCount === 1 && firstInvalidField
        ? nextErrors[firstInvalidField] ?? "请先补全必填项"
        : `请先补全 ${missingCount} 个必填项后再保存`
    );

    if (firstInvalidField) {
      window.requestAnimationFrame(() => {
        focusField(firstInvalidField);
      });
    }

    return false;
  };

  const handleSave = async () => {
    const name = formState.name.trim();
    const baseUrl = formState.baseUrl.trim();
    const apiKey = formState.apiKey.trim();
    const modelId = formState.modelId.trim() || undefined;
    const roleModels = buildRoleModelsPayload(formState);

    if (!validateForm()) {
      return;
    }

    if (connectionTestState?.status === "error") {
      const failingRoles = getFailingConfiguredRoles(formState, connectionTestState.details);

      if (failingRoles.length > 0) {
        setErrorMessage(
          `检测到测试失败的模型：${failingRoles.join("、")}。请修正或清空后再保存。`
        );
        return;
      }

      if (!connectionTestState.details) {
        setErrorMessage("当前连接测试未通过，请修正后再保存。");
        return;
      }
    }

    setIsSaving(true);
    setErrorMessage(null);
    setFieldErrors({});

    try {
      if (isEditing && formMode) {
        const payload: ProviderUpdateInput = {
          name,
          providerType: formState.providerType,
          baseUrl,
          modelId,
          roleModels,
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
          modelId,
          roleModels,
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
        details: null,
      });
      return;
    }

    clearTransientTestStatus();
    const testRunId = window.crypto.randomUUID();
    activeTestRunIdRef.current = testRunId;
    setIsTestingConnection(true);
    setTestingFieldKeys(collectTestingFieldKeys(formState));
    setErrorMessage(null);
    setFieldErrors({});
    setConnectionTestState(null);

    try {
      let effectiveApiKey = formState.apiKey.trim();
      if (!effectiveApiKey && isEditing && formMode) {
        const currentApiKey = await window.zora.getProviderApiKey(formMode.providerId);
        effectiveApiKey = currentApiKey?.trim() ?? "";
      }

      if (activeTestRunIdRef.current !== testRunId) {
        return;
      }

      if (!effectiveApiKey) {
        if (isEditing) {
          setShowApiKey(true);
        }
        setValidationError(
          "apiKey",
          isEditing
            ? "当前 API Key 无法读取，请点击右侧图标重新填写后再测试。"
            : "请先填写 API Key 后再测试连接。"
        );
        return;
      }

      const modelId = formState.modelId.trim() || undefined;
      const roleModels = buildRoleModelsPayload(formState);

      if (modelId || roleModels) {
        const result = await window.zora.testProviderWithRoleModels(
          formState.baseUrl.trim(),
          effectiveApiKey,
          modelId,
          roleModels,
          testRunId
        );
        if (activeTestRunIdRef.current !== testRunId) {
          return;
        }
        setConnectionTestState({
          status: result.success ? "success" : "error",
          message: result.message,
          details: result.details,
        });
      } else {
        const result = await window.zora.testProvider(
          formState.baseUrl.trim(),
          effectiveApiKey,
          modelId,
          testRunId
        );
        if (activeTestRunIdRef.current !== testRunId) {
          return;
        }
        setConnectionTestState({
          status: result.success ? "success" : "error",
          message: result.message,
          details: null,
        });
      }
    } catch (error) {
      if (activeTestRunIdRef.current !== testRunId) {
        return;
      }
      setConnectionTestState({
        status: "error",
        message: getErrorMessage(error),
        details: null,
      });
    } finally {
      if (activeTestRunIdRef.current === testRunId) {
        clearTestingUiState();
      }
    }
  };

  const handleStopConnectionTest = async () => {
    const testRunId = activeTestRunIdRef.current;
    if (!testRunId) {
      return;
    }

    clearTestingUiState();
    setErrorMessage(null);
    setFieldErrors({});
    showStoppedTestMessage();

    if (typeof window.zora.cancelProviderTest !== "function") {
      return;
    }

    try {
      await window.zora.cancelProviderTest(testRunId);
    } catch (error) {
      console.warn("[provider:test] Failed to cancel provider test:", error);
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
      setFieldErrors({});

      try {
        const currentApiKey = await window.zora.getProviderApiKey(formMode.providerId);

        if (!currentApiKey) {
          setShowApiKey(true);
          setValidationError("apiKey", "未能读取当前 API Key，请重新输入后再试。");
          return;
        }

        updateFormState({
          apiKey: currentApiKey,
        });
      } catch (error) {
        setShowApiKey(true);
        setValidationError("apiKey", getErrorMessage(error));
        return;
      } finally {
        setIsLoadingApiKey(false);
      }
    }

    setShowApiKey(true);
  };

  const mainModelTestDetail = findRoleTestDetail(connectionTestState?.details, "main");
  const connectionSummary = summarizeConnectionTest(connectionTestState);

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 w-full pb-12 duration-500">
      {/* 头部 */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13px] text-stone-500">已添加 {providers.length} 个配置</span>
        <Button type="button" onClick={openCreateForm} size="sm" className="h-7 px-3 text-[12px]">
          <span className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            添加
          </span>
        </Button>
      </div>

      {errorMessage ? (
          <div
            className="mb-4 flex items-start gap-2.5 rounded-lg border border-rose-200/60 bg-rose-50/80 px-4 py-2.5 text-[13px] text-rose-600"
            role="alert"
            aria-live="assertive"
          >
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="font-medium">{errorMessage}</p>
          </div>
        ) : null}

        {providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-200/70 bg-stone-50/40 px-6 py-10 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-stone-200/40">
              <svg className="h-5 w-5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <h3 className="text-[15px] font-medium text-stone-800">暂无模型配置</h3>
            <p className="mt-1 max-w-sm text-[13px] text-stone-500">
              添加一个可用的模型服务端点即可开始使用。
            </p>
          </div>
        ) : (
          <div className="flex flex-col overflow-hidden rounded-xl bg-white ring-1 ring-stone-200/40 divide-y divide-stone-100/60">
            {providers.map((provider) => {
              const isCardBusy = activeCardActionId === provider.id;

              return (
                <div key={provider.id} className={cn(
                  "group relative flex items-center justify-between px-5 py-3.5 transition-all duration-200",
                  provider.isDefault ? "bg-stone-50/30" : "hover:bg-stone-50/50"
                )}>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-medium tracking-tight text-stone-900">
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

                  <div className="flex shrink-0 items-center gap-2 pl-3">
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
                      className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50"
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
                    
                    {provider.isDefault && (
                      <div className="ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {formMode ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-stone-900/20 p-3 backdrop-blur-sm animate-in fade-in duration-200 sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isFormBusy) {
              closeForm();
            }
          }}
        >
          <div
            className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-[540px] flex-col overflow-hidden rounded-[22px] bg-white shadow-2xl ring-1 ring-black/5 animate-in zoom-in-95 duration-200 slide-in-from-bottom-4 sm:max-h-[calc(100vh-2rem)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby={DIALOG_TITLE_ID}
          >
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
              <h3 id={DIALOG_TITLE_ID} className="text-[16px] font-semibold tracking-tight text-stone-900">
                {formMode.type === "edit" ? "编辑配置" : "新增配置"}
              </h3>
              <button
                type="button"
                onClick={closeForm}
                disabled={isFormBusy}
                aria-label="关闭配置弹窗"
                className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {errorMessage ? (
              <div
                className="shrink-0 border-b border-rose-100 bg-rose-50/90 px-6 py-3"
                role="alert"
                aria-live="assertive"
              >
                <div className="flex items-start gap-2.5 text-[13px] text-rose-700">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="font-medium">{errorMessage}</p>
                </div>
              </div>
            ) : null}

            {!errorMessage && connectionSummary ? (
              <div
                className={cn(
                  "shrink-0 border-b px-6 py-3",
                  connectionSummary.tone === "success"
                    ? "border-emerald-100 bg-emerald-50/90"
                    : "border-rose-100 bg-rose-50/90"
                )}
                role="status"
                aria-live="polite"
              >
                <div
                  className={cn(
                    "flex items-start gap-2.5 text-[13px]",
                    connectionSummary.tone === "success"
                      ? "text-emerald-700"
                      : "text-rose-700"
                  )}
                >
                  {connectionSummary.tone === "success" ? (
                    <span className="mt-0.5">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : connectionSummary.tone === "error" ? (
                    <span className="mt-0.5">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </span>
                  ) : null}
                  <p className="font-medium">{connectionSummary.message}</p>
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-5">
                <div className="space-y-0">
                  <FormRow
                    label="名称"
                    required
                    helperText={fieldErrors.name}
                    helperTextId="provider-name-message"
                    error={Boolean(fieldErrors.name)}
                  >
                    <input
                      ref={nameInputRef}
                      className={cn(
                        inputClassName,
                        fieldErrors.name && "border-rose-300 text-rose-700 focus:border-rose-500"
                      )}
                      value={formState.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      placeholder="我的模型"
                      disabled={isTestingConnection}
                      aria-invalid={Boolean(fieldErrors.name)}
                      aria-describedby={fieldErrors.name ? "provider-name-message" : undefined}
                    />
                  </FormRow>
                  
                  <FormRow label="供应商">
                    <select
                      className={cn(inputClassName, "cursor-pointer appearance-none")}
                      value={formState.providerType}
                      onChange={(e) => {
                        const nextType = e.target.value as ProviderType;
                        updateFormState((c) => ({ ...c, providerType: nextType, baseUrl: PROVIDER_PRESETS[nextType].defaultUrl }));
                      }}
                      disabled={isTestingConnection}
                    >
                      {Object.entries(PROVIDER_PRESETS).map(([providerType, preset]) => (
                        <option key={providerType} value={providerType}>{preset.label}</option>
                      ))}
                    </select>
                  </FormRow>
                  
                  <FormRow
                    label="Base URL"
                    required
                    helperText={fieldErrors.baseUrl}
                    helperTextId="provider-base-url-message"
                    error={Boolean(fieldErrors.baseUrl)}
                  >
                    <input
                      ref={baseUrlInputRef}
                      className={cn(
                        technicalInputClassName,
                        fieldErrors.baseUrl && "border-rose-300 text-rose-700 focus:border-rose-500"
                      )}
                      value={formState.baseUrl}
                      onChange={(e) => updateField("baseUrl", e.target.value)}
                      placeholder="https://..."
                      disabled={isTestingConnection}
                      aria-invalid={Boolean(fieldErrors.baseUrl)}
                      aria-describedby={fieldErrors.baseUrl ? "provider-base-url-message" : undefined}
                    />
                  </FormRow>
                  
                  <FormRow
                    label="API Key"
                    isLast={true}
                    required={!isEditing}
                    helperText={
                      fieldErrors.apiKey ??
                      (isEditing
                        ? "留空会保留当前 API Key；测试连接会自动使用已保存的 Key。"
                        : undefined)
                    }
                    helperTextId="provider-api-key-message"
                    error={Boolean(fieldErrors.apiKey)}
                  >
                    <div className="relative flex items-center">
                      <input
                        ref={apiKeyInputRef}
                        type={showApiKey ? "text" : "password"}
                        className={cn(
                          technicalInputClassName,
                          "pr-8",
                          isApiKeyLocked && "text-stone-400",
                          fieldErrors.apiKey && "border-rose-300 text-rose-700 focus:border-rose-500"
                        )}
                        value={isApiKeyLocked ? MASKED_API_KEY_DISPLAY : formState.apiKey}
                        onChange={(e) => updateField("apiKey", e.target.value)}
                        placeholder={isEditing ? "保留当前 Key，点击右侧查看或替换" : "sk-..."}
                        disabled={isTestingConnection}
                        readOnly={isApiKeyLocked}
                        tabIndex={isApiKeyLocked ? -1 : 0}
                        aria-invalid={Boolean(fieldErrors.apiKey)}
                        aria-describedby="provider-api-key-message"
                      />
                      <button
                        type="button"
                        onClick={() => void handleToggleApiKeyVisibility()}
                        disabled={isLoadingApiKey || isTestingConnection}
                        aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                        className="absolute right-2 flex h-6 w-6 items-center justify-center text-stone-400 hover:text-stone-700 disabled:opacity-50"
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
                  </FormRow>
                </div>

                <div className="border-t border-stone-100 pt-4">
                  <FormRow label="主模型 ID" vertical>
                    <div className="relative flex items-center">
                      <input
                        className={cn(technicalInputClassName, "pr-8")}
                        value={formState.modelId}
                        onChange={(e) => updateField("modelId", e.target.value)}
                        placeholder="留空使用默认"
                        disabled={isTestingConnection}
                      />
                      {isTestingConnection && testingFieldKeys.includes("modelId") && (
                        <div className="absolute right-2"><svg className="h-4 w-4 animate-spin text-stone-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>
                      )}
                      {mainModelTestDetail && (
                        <div className={cn("absolute right-2", mainModelTestDetail.success ? "text-emerald-500" : "text-rose-500")}>
                          {mainModelTestDetail.success ? "✓" : "✗"}
                        </div>
                      )}
                    </div>
                    {mainModelTestDetail && !mainModelTestDetail.success && (
                       <p className="mt-1 text-[11px] text-rose-500">{mainModelTestDetail.message}</p>
                    )}
                  </FormRow>

                  <div className="border-t border-stone-100 pt-3">
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 text-left text-[12.5px] font-medium text-stone-500 transition-colors hover:text-stone-700"
                      onClick={() => setShowRoleModels((prev) => !prev)}
                    >
                      <svg
                        className={`h-3 w-3 transition-transform ${showRoleModels ? "rotate-90" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                      高级：角色模型映射 (仅支持多模型供应商)
                    </button>
                  </div>

                  {showRoleModels && (
                    <div className="mt-2 border-t border-stone-100 pt-2">
                      {ROLE_MODEL_FIELDS.map(({ field, role, label }, index) => {
                         const testDetail = findRoleTestDetail(connectionTestState?.details, role);
                         return (
                          <FormRow key={field} label={label} vertical isLast={index === 3}>
                            <div className="relative flex items-center">
                              <input
                                type="text"
                                value={formState[field]}
                                onChange={(e) => updateField(field, e.target.value)}
                                placeholder="留空则使用主模型"
                                disabled={isTestingConnection}
                                className={cn(technicalInputClassName, "pr-8")}
                              />
                              {isTestingConnection && testingFieldKeys.includes(field) && (
                                <div className="absolute right-2"><svg className="h-4 w-4 animate-spin text-stone-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>
                              )}
                              {testDetail && formState[field].trim() !== "" && (
                                <div className={cn("absolute right-2", testDetail.success ? "text-emerald-500" : "text-rose-500")}>
                                  {testDetail.success ? "✓" : "✗"}
                                </div>
                              )}
                            </div>
                            {testDetail && !testDetail.success && formState[field].trim() !== "" && (
                              <p className="mt-1 text-[11px] text-rose-500">{testDetail.message}</p>
                            )}
                          </FormRow>
                        );
                      })}
                      <p className="pt-3 text-[11px] leading-relaxed text-stone-400">
                        留空的角色会自动回退到上方主模型，仅在同一 Provider 支持多模型时再单独填写。
                      </p>
                    </div>
                  )}
                </div>
              </div>

            </div>

            <div className="shrink-0 border-t border-stone-100 bg-white px-6 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant={isTestingConnection ? "danger" : "secondary"}
                  onClick={() =>
                    void (isTestingConnection ? handleStopConnectionTest() : handleTestConnection())
                  }
                  disabled={isTestingConnection ? false : !canTestConnection || isSaving}
                  className="w-full sm:w-auto"
                >
                  {isTestingConnection ? "停止测试" : "测试连接"}
                </Button>

                <div className="flex w-full gap-2 sm:w-auto sm:justify-end">
                  <Button type="button" variant="ghost" onClick={closeForm} disabled={isFormBusy} className="flex-1 sm:flex-none">
                    取消
                  </Button>
                  <Button type="button" onClick={() => void handleSave()} disabled={isFormBusy} className="min-w-[80px] flex-1 sm:flex-none">
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
