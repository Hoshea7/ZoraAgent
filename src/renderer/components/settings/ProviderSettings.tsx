import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAtomValue, useSetAtom } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { DefaultModelSettings } from "../../../shared/types/default-model";
import {
  type ProviderConfig,
  type ProviderCreateInput,
  type ProviderModel,
  type ProviderPresetId,
  type ProviderProtocol,
  type ProviderType,
  type ProviderUpdateInput,
} from "../../../shared/types/provider";
import {
  PROVIDER_PRESETS,
  resolveProviderPreset,
} from "../../../shared/provider-presets";
import { resolveProviderProtocol } from "../../../shared/provider-protocol";
import { mergeFetchedProviderModels } from "../../../shared/provider-model";
import {
  defaultModelSettingsAtom,
  loadDefaultModelSettingsAtom,
  updateDefaultModelSettingsAtom,
} from "../../store/default-model";
import { loadProvidersAtom, providersAtom } from "../../store/provider";
import { getErrorMessage } from "../../utils/message";
import { formatProviderTestError } from "../../utils/provider-test-message";
import {
  getProviderModels,
  normalizeOptionalModelId,
  resolveConfiguredDefaultTarget,
  resolveSelectedModelId,
} from "../../utils/provider-selection";
import { Button } from "../ui/Button";
import { cn } from "../../utils/cn";
import { VisibilityIcon } from "../ui/VisibilityIcon";
import { ProviderIcon } from "./ProviderPresentation";
import { ImageCapabilityOverrides } from "./ImageCapabilityOverrides";

type FormMode =
  | { type: "create" }
  | { type: "edit"; providerId: string }
  | null;

type DeleteConfirmation =
  | { kind: "provider"; providerId: string; name: string; inUse: boolean }
  | { kind: "model"; modelId: string; name: string; inUse: boolean };

type ValidationField = "name" | "baseUrl" | "apiKey";
type FieldErrors = Partial<Record<ValidationField, string>>;

interface ProviderFormState {
  name: string;
  presetId: ProviderPresetId;
  providerType: ProviderType;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  models: ProviderModel[];
  manualModelId: string;
  manualModelName: string;
}

interface ConnectionTestState {
  status: "success" | "error" | "info";
  message: string;
}

type ModelTestState = {
  status: "testing" | "stopping" | "success" | "error" | "stopped";
  message: string;
};

function CompactSwitch({
  enabled,
  label,
  title,
  disabled,
  onChange,
}: {
  enabled: boolean;
  label: string;
  title: string;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2",
        enabled
          ? "bg-stone-800 hover:bg-stone-700"
          : "bg-stone-200 hover:bg-stone-300",
        disabled && "cursor-not-allowed opacity-45"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          enabled ? "translate-x-[18px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function ModelEnabledControl({
  enabled,
  modelName,
  disabled,
  onChange,
}: {
  enabled: boolean;
  modelName: string;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <CompactSwitch
      enabled={enabled}
      label={`${enabled ? "停用" : "启用"}模型 ${modelName}`}
      title={enabled ? "停用模型" : "启用模型"}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function DeleteModelButton({
  modelName,
  disabled,
  onDelete,
}: {
  modelName: string;
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`删除模型 ${modelName}`}
      title="删除模型"
      disabled={disabled}
      onClick={onDelete}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  );
}

function ModelTestIndicator({
  state,
  modelName,
}: {
  state: ModelTestState;
  modelName: string;
}) {
  const label =
    state.status === "testing"
      ? "测试中"
      : state.status === "stopping"
        ? "正在停止"
      : state.status === "success"
        ? "连接成功"
        : state.status === "stopped"
          ? "已停止"
          : "连接失败";

  return (
    <span
      role="status"
      aria-label={`${modelName}：${label}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium",
        state.status === "success"
          ? "text-emerald-600"
          : state.status === "error"
            ? "text-rose-600"
            : "text-stone-500"
      )}
    >
      {state.status === "testing" || state.status === "stopping" ? (
        <svg aria-hidden="true" className="h-3.5 w-3.5 animate-spin" viewBox="0 0 20 20" fill="none">
          <circle className="opacity-20" cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2.5" />
          <path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : state.status === "success" ? (
        <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100">
          <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none">
            <path d="m2.5 6.2 2.1 2.1 4.9-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : state.status === "error" ? (
        <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-100">
          <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none">
            <path d="m3 3 6 6m0-6L3 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </span>
      ) : (
        <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center rounded-full bg-stone-100">
          <span className="h-1.5 w-1.5 rounded-[1px] bg-current" />
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}

type DefaultModelUiState = {
  triggerLabel: string;
  helperText: string;
  hasOptions: boolean;
  selectedProviderId: string | null;
  selectedModelId?: string;
};

const DEFAULT_PROVIDER_PRESET_ID: ProviderPresetId = "anthropic";
const MASKED_API_KEY_DISPLAY = "••••••••••••••••••••";
const inputClassName = [
  "h-9 w-full rounded-[6px] border border-stone-200/80 bg-white/55 px-2.5 text-[13px] text-stone-900",
  "outline-none transition-colors placeholder:text-stone-400",
  "focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-200/50",
  "disabled:cursor-not-allowed disabled:opacity-60",
].join(" ");
const technicalInputClassName = cn(
  inputClassName,
  "font-mono text-[13px] tracking-tight"
);
const VALIDATION_FIELD_ORDER: ValidationField[] = ["name", "baseUrl", "apiKey"];
const DIALOG_TITLE_ID = "provider-settings-dialog-title";

function hasDefaultModelSettingsDifference(
  settings: DefaultModelSettings,
  patch: Partial<DefaultModelSettings>
): boolean {
  if (
    patch.defaultProviderId !== undefined &&
    patch.defaultProviderId !== settings.defaultProviderId
  ) {
    return true;
  }

  if (
    patch.defaultModelId !== undefined &&
    patch.defaultModelId !== settings.defaultModelId
  ) {
    return true;
  }

  return false;
}

function createDefaultModelSelectionPatch(
  provider: ProviderConfig,
  modelId: string
): Partial<DefaultModelSettings> {
  return {
    defaultProviderId: provider.id,
    defaultModelId: modelId,
  };
}

function buildDefaultModelUiState(
  settings: DefaultModelSettings,
  providers: ProviderConfig[]
): DefaultModelUiState {
  const availableProviders = providers.filter(
    (provider) => provider.enabled && getProviderModels(provider).length > 0
  );

  if (availableProviders.length === 0) {
    return {
      triggerLabel: "暂无模型",
      helperText: "请先添加一个可用模型。",
      hasOptions: false,
      selectedProviderId: null,
    };
  }

  const configuredDefault = resolveConfiguredDefaultTarget(providers, settings);
  const selectedProvider = configuredDefault.provider;
  const selectedModelId = normalizeOptionalModelId(configuredDefault.modelId);

  return {
    triggerLabel: selectedModelId ?? "暂无模型",
    helperText:
      selectedProvider && selectedModelId
        ? `新会话默认使用 ${selectedProvider.name} · ${selectedModelId}`
        : "请先添加一个可用模型。",
    hasOptions: true,
    selectedProviderId: selectedProvider?.id ?? null,
    selectedModelId,
  };
}

function summarizeConnectionTest(
  connectionTestState: ConnectionTestState | null
): { tone: "success" | "error" | "info"; message: string } | null {
  if (!connectionTestState) {
    return null;
  }

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
          "group py-2.5",
          vertical
            ? "flex flex-col gap-1.5"
            : "grid gap-2 sm:grid-cols-[104px_minmax(0,1fr)] sm:items-start sm:gap-5"
        )}
      >
        <span
          className={cn(
            "pt-2 text-[12.5px] font-medium text-stone-500",
            !vertical && "whitespace-nowrap",
            vertical && "pt-0"
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
                "pt-1 text-[11.5px] leading-relaxed",
                error ? "text-rose-600" : "text-stone-400"
              )}
            >
              {helperText}
            </p>
          ) : null}
        </div>
      </div>
      {!isLast && <div className="h-px bg-stone-100/70" />}
    </>
  );
}

function createEmptyFormState(): ProviderFormState {
  const preset = PROVIDER_PRESETS[DEFAULT_PROVIDER_PRESET_ID];
  return {
    name: "",
    presetId: preset.id,
    providerType: preset.providerType,
    protocol: preset.protocol,
    baseUrl: preset.defaultUrl,
    apiKey: "",
    models: [],
    manualModelId: "",
    manualModelName: "",
  };
}

function createEditFormState(provider: ProviderConfig): ProviderFormState {
  const protocol = resolveProviderProtocol(provider);
  const preset = resolveProviderPreset({ ...provider, protocol });
  return {
    name: provider.name,
    presetId: preset.id,
    providerType: preset.providerType,
    protocol,
    baseUrl: provider.baseUrl,
    apiKey: "",
    models: provider.models.map((model) => ({ ...model })),
    manualModelId: "",
    manualModelName: "",
  };
}

export function ProviderSettings() {
  const defaultModelSettings = useAtomValue(defaultModelSettingsAtom);
  const loadDefaultModelSettings = useSetAtom(loadDefaultModelSettingsAtom);
  const updateDefaultModelSettings = useSetAtom(updateDefaultModelSettingsAtom);
  const providers = useAtomValue(providersAtom);
  const loadProviders = useSetAtom(loadProvidersAtom);

  const [formMode, setFormMode] = useState<FormMode>(null);
  const [formState, setFormState] = useState<ProviderFormState>(createEmptyFormState);
  const [defaultModelErrorMessage, setDefaultModelErrorMessage] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isLoadingApiKey, setIsLoadingApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [availableModelQuery, setAvailableModelQuery] = useState("");
  const [activeCardActionId, setActiveCardActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manualModelError, setManualModelError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [connectionTestState, setConnectionTestState] = useState<ConnectionTestState | null>(null);
  const [modelTestStates, setModelTestStates] = useState<Record<string, ModelTestState>>({});
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const baseUrlInputRef = useRef<HTMLInputElement | null>(null);
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null);
  const activeTestRunIdRef = useRef<string | null>(null);
  const testStatusTimeoutRef = useRef<number | null>(null);

  const isEditing = formMode?.type === "edit";
  const editingProvider =
    formMode?.type === "edit"
      ? providers.find((provider) => provider.id === formMode.providerId) ?? null
      : null;
  const isApiKeyLocked = isEditing && !showApiKey;
  const isFormBusy = isSaving || isTestingConnection || isFetchingModels || isLoadingApiKey;
  const canTestConnection =
    formState.baseUrl.trim().length > 0 &&
    (isEditing || formState.apiKey.trim().length > 0) &&
    formState.models.some((model) => model.enabled) &&
    editingProvider?.enabled !== false &&
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
  };

  const showStoppedTestMessage = () => {
    clearTransientTestStatus();
    setConnectionTestState({
      status: "info",
      message: "测试已停止",
    });
    setModelTestStates((current) =>
      Object.fromEntries(
        Object.entries(current).map(([modelId, state]) => [
          modelId,
          state.status === "testing"
            ? { status: "stopped", message: "已停止" }
            : state,
        ])
      )
    );
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
    setModelTestStates({});
    setAvailableModelQuery("");
    setFieldErrors({});
    setErrorMessage(null);
    setManualModelError(null);
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
      setModelTestStates({});
    }
    setErrorMessage(null);
    setManualModelError(null);

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
    setErrorMessage(null);
    setManualModelError(null);
    setFieldErrors({});
    setConnectionTestState(null);
    setModelTestStates({});
    setAvailableModelQuery("");
  };

  const openEditForm = (provider: ProviderConfig) => {
    clearTransientTestStatus();
    setFormMode({ type: "edit", providerId: provider.id });
    setFormState(createEditFormState(provider));
    setShowApiKey(false);
    setErrorMessage(null);
    setManualModelError(null);
    setFieldErrors({});
    setConnectionTestState(null);
    setModelTestStates({});
    setAvailableModelQuery("");
  };

  const closeForm = () => {
    clearTransientTestStatus();
    setFormMode(null);
    setFormState(createEmptyFormState());
    setShowApiKey(false);
    setErrorMessage(null);
    setManualModelError(null);
    setFieldErrors({});
    setConnectionTestState(null);
    setModelTestStates({});
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
    setDefaultModelErrorMessage(null);
    void loadDefaultModelSettings().catch((error) => {
      setDefaultModelErrorMessage(getErrorMessage(error));
    });
  }, [loadDefaultModelSettings]);

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

  const handleSelectDefaultModel = async (
    patch: Partial<DefaultModelSettings>
  ) => {
    if (
      !defaultModelSettings ||
      !hasDefaultModelSettingsDifference(defaultModelSettings, patch)
    ) {
      return;
    }

    setDefaultModelErrorMessage(null);

    try {
      await updateDefaultModelSettings(patch);
    } catch (error) {
      setDefaultModelErrorMessage(getErrorMessage(error));
    }
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
      nextErrors.baseUrl = "请填写接口地址";
    }

    if (!isEditing && !formState.apiKey.trim()) {
      nextErrors.apiKey = "请填写密钥";
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

    if (!validateForm()) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setFieldErrors({});

    try {
      if (isEditing && formMode) {
        const payload: ProviderUpdateInput = {
          name,
          presetId: formState.presetId,
          providerType: formState.providerType,
          protocol: formState.protocol,
          baseUrl,
          models: formState.models,
        };

        if (apiKey) {
          payload.apiKey = apiKey;
        }

        await window.zora.updateProvider(formMode.providerId, payload);
      } else {
        const payload: ProviderCreateInput = {
          name,
          presetId: formState.presetId,
          providerType: formState.providerType,
          protocol: formState.protocol,
          baseUrl,
          apiKey,
          models: formState.models,
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

  const handleAddManualModel = () => {
    const id = formState.manualModelId.trim();
    const name = formState.manualModelName.trim();
    if (!id) {
      setManualModelError("请填写模型 ID。");
      return;
    }
    if (formState.models.some((model) => model.id === id)) {
      setManualModelError("模型已存在。");
      return;
    }
    setManualModelError(null);
    updateFormState((current) => ({
      ...current,
      models: [
        ...current.models,
        { id, ...(name ? { name } : {}), enabled: true },
      ],
      manualModelId: "",
      manualModelName: "",
    }));
  };

  const handleSetModelEnabled = (modelId: string, enabled: boolean) => {
    updateFormState((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.id === modelId ? { ...model, enabled } : model
      ),
    }));
  };

  const removeModelFromDraft = (modelId: string) => {
    updateFormState((current) => ({
      ...current,
      models: current.models.filter((model) => model.id !== modelId),
    }));
  };

  const requestDeleteModel = async (model: ProviderModel) => {
    setErrorMessage(null);
    try {
      const impact = isEditing && formMode
        ? await window.zora.getProviderReferenceImpact(formMode.providerId, model.id)
        : { inUse: false };
      setDeleteConfirmation({
        kind: "model",
        modelId: model.id,
        name: model.name ?? model.id,
        inUse: impact.inUse,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleFetchModels = async () => {
    if (!formState.baseUrl.trim()) {
      setValidationError("baseUrl", "请先填写接口地址。");
      return;
    }
    setIsFetchingModels(true);
    setErrorMessage(null);
    setConnectionTestState(null);
    try {
      let apiKey = formState.apiKey.trim();
      if (!apiKey && isEditing && formMode) {
        apiKey = (await window.zora.getProviderApiKey(formMode.providerId))?.trim() ?? "";
      }
      if (!apiKey) {
        setValidationError("apiKey", "请先填写密钥。");
        return;
      }
      const fetched = await window.zora.fetchProviderModels({
        presetId: formState.presetId,
        providerType: formState.providerType,
        protocol: formState.protocol,
        baseUrl: formState.baseUrl.trim(),
        apiKey,
      });
      setFormState((current) => ({
        ...current,
        models: mergeFetchedProviderModels(current.models, fetched),
      }));
    } catch {
      setErrorMessage("获取失败，请手动添加模型。");
    } finally {
      setIsFetchingModels(false);
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

  const requestDeleteProvider = async (provider: ProviderConfig) => {
    setActiveCardActionId(provider.id);
    setErrorMessage(null);
    try {
      const impact = await window.zora.getProviderReferenceImpact(provider.id);
      setDeleteConfirmation({
        kind: "provider",
        providerId: provider.id,
        name: provider.name,
        inUse: impact.inUse,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setActiveCardActionId(null);
    }
  };

  const confirmDeletion = async () => {
    const confirmation = deleteConfirmation;
    if (!confirmation) return;
    setDeleteConfirmation(null);
    if (confirmation.kind === "provider") {
      await handleDelete(confirmation.providerId);
      return;
    }
    removeModelFromDraft(confirmation.modelId);
  };

  const handleToggleProvider = async (provider: ProviderConfig) => {
    setActiveCardActionId(provider.id);
    setErrorMessage(null);
    try {
      await window.zora.updateProvider(provider.id, { enabled: !provider.enabled });
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

    clearTransientTestStatus();
    const testRunId = window.crypto.randomUUID();
    const modelIds = formState.models
      .filter((model) => model.enabled)
      .map((model) => model.id);
    activeTestRunIdRef.current = testRunId;
    setIsTestingConnection(true);
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
            ? "当前密钥无法读取，请点击右侧图标重新填写后再测试。"
            : "请先填写密钥后再测试连接。"
        );
        return;
      }

      setModelTestStates(
        Object.fromEntries(
          modelIds.map((modelId) => [
            modelId,
            { status: "testing", message: "测试中" },
          ])
        )
      );
      const result = await window.zora.testProviderModels({
        providerId: isEditing && formMode ? formMode.providerId : undefined,
        providerName: formState.name.trim() || undefined,
        presetId: formState.presetId,
        baseUrl: formState.baseUrl.trim(),
        apiKey: effectiveApiKey,
        models: formState.models.filter((model) => model.enabled),
        testRunId,
        protocol: formState.protocol,
        providerType: formState.providerType,
      });
      if (activeTestRunIdRef.current !== testRunId) return;
      setModelTestStates(
        Object.fromEntries(
          result.results.map((item) => [
            item.modelId,
            {
              status: item.success ? "success" : "error",
              message: item.message,
            },
          ])
        )
      );
      setConnectionTestState({
        status: result.success ? "success" : "error",
        message: result.success
          ? `${result.results.length} 个模型连接成功`
          : `${result.results.filter((item) => item.success).length}/${result.results.length} 个模型连接成功`,
      });
    } catch (error) {
      if (activeTestRunIdRef.current !== testRunId) {
        return;
      }
      setModelTestStates((current) =>
        Object.fromEntries(
          Object.entries(current).map(([modelId, state]) => [
            modelId,
            state.status === "testing"
              ? { status: "error", message: getErrorMessage(error) }
              : state,
          ])
        )
      );
      setConnectionTestState({
        status: "error",
        message: getErrorMessage(error),
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

    setErrorMessage(null);
    setFieldErrors({});
    setConnectionTestState({ status: "info", message: "正在停止测试…" });
    setModelTestStates((current) =>
      Object.fromEntries(
        Object.entries(current).map(([modelId, state]) => [
          modelId,
          state.status === "testing"
            ? { status: "stopping", message: "正在停止" }
            : state,
        ])
      )
    );

    try {
      const cancelled = await window.zora.cancelProviderTest(testRunId);
      if (!cancelled) {
        throw new Error("测试已经结束，无需停止。");
      }
      if (activeTestRunIdRef.current === testRunId) clearTestingUiState();
      showStoppedTestMessage();
    } catch (error) {
      setConnectionTestState({
        status: "error",
        message: `停止失败：${getErrorMessage(error)}`,
      });
      setModelTestStates((current) =>
        Object.fromEntries(
          Object.entries(current).map(([modelId, state]) => [
            modelId,
            state.status === "stopping"
              ? { status: "testing", message: "测试中" }
              : state,
          ])
        )
      );
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
          setValidationError("apiKey", "未能读取当前密钥，请重新输入后再试。");
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

  const connectionSummary = summarizeConnectionTest(connectionTestState);
  const availableModels = formState.models.filter((model) => !model.enabled);
  const normalizedAvailableModelQuery = availableModelQuery.trim().toLowerCase();
  const visibleAvailableModels = normalizedAvailableModelQuery
    ? availableModels.filter((model) =>
        [model.id, model.name].some((value) =>
          value?.toLowerCase().includes(normalizedAvailableModelQuery)
        )
      )
    : availableModels;
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const defaultModelUiState = defaultModelSettings
    ? buildDefaultModelUiState(defaultModelSettings, providers)
    : null;
  const selectedDefaultProvider = providers.find(
    (provider) => provider.id === defaultModelUiState?.selectedProviderId
  );

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 w-full pb-12 duration-500">
      <div className="mb-5 flex items-start justify-between gap-6">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-stone-900">模型配置</h2>
          <p className="mt-1 text-[12.5px] leading-5 text-stone-500">
            管理模型服务、接口协议和可用 Runtime。已添加 {providers.length} 个配置。
          </p>
        </div>
        <Button type="button" onClick={openCreateForm} size="sm" className="h-8 shrink-0 px-3.5 text-[12px]">
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

      {defaultModelErrorMessage ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-rose-200/60 bg-rose-50/80 px-4 py-2.5 text-[13px] text-rose-600">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="font-medium">{defaultModelErrorMessage}</p>
        </div>
      ) : null}

      <div className="mb-5 rounded-2xl border border-stone-200/70 bg-stone-50/45 p-4">
        <div className="flex items-start gap-4">
          <h3 className="w-[88px] shrink-0 pt-2 text-[15px] font-medium text-stone-900">
            默认模型
          </h3>

          <div className="min-w-0 flex-1">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className={cn(
                    "flex h-10 w-full items-center justify-between rounded-lg bg-white px-3.5",
                    "text-[13px] text-stone-700 ring-1 ring-stone-200/60 transition-all",
                    "hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-200/40",
                    !defaultModelUiState?.hasOptions &&
                      "cursor-not-allowed text-stone-400 hover:bg-white"
                  )}
                  disabled={!defaultModelUiState?.hasOptions}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {selectedDefaultProvider ? (
                      <ProviderIcon provider={selectedDefaultProvider} className="h-6 w-6 rounded-md shadow-none" />
                    ) : null}
                    <span className="truncate">
                      {defaultModelUiState?.triggerLabel ?? "暂无模型"}
                    </span>
                  </span>
                  <svg className="ml-3 h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="bottom"
                  align="start"
                  className="z-50 max-h-64 overflow-y-auto rounded-lg border border-stone-200/60 bg-white shadow-lg shadow-stone-200/50"
                  style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)" }}
                >
                  {enabledProviders.map((provider, providerIndex) => {
                    const models = getProviderModels(provider);
                    if (models.length === 0) {
                      return null;
                    }

                    return (
                      <div key={provider.id}>
                        {providerIndex > 0 && <div className="border-t border-stone-100" />}
                        <div className="flex items-center gap-2 bg-stone-50/80 px-3 py-1.5 text-[11px] font-medium text-stone-500">
                          <ProviderIcon provider={provider} className="h-5 w-5 rounded-[5px] shadow-none" />
                          <span>{provider.name}</span>
                        </div>
                        {models.map((model) => (
                          <DropdownMenu.Item
                            key={`${provider.id}:${model.modelId}`}
                            className={cn(
                              "cursor-pointer px-4 py-2 text-[13px] text-stone-600 outline-none hover:bg-stone-50 data-[highlighted]:bg-stone-50",
                              defaultModelUiState?.selectedProviderId === provider.id &&
                                defaultModelUiState.selectedModelId === model.modelId &&
                                "bg-stone-50 font-medium text-stone-900"
                            )}
                            onSelect={() =>
                              void handleSelectDefaultModel(
                                createDefaultModelSelectionPatch(
                                  provider,
                                  model.modelId
                                )
                              )
                            }
                          >
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-4 w-4 items-center justify-center text-stone-400">
                                {defaultModelUiState?.selectedProviderId === provider.id &&
                                defaultModelUiState.selectedModelId === model.modelId ? (
                                  <svg
                                    className="h-3.5 w-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M5 13l4 4L19 7"
                                    />
                                  </svg>
                                ) : null}
                              </span>
                              <span className="truncate">{model.modelId}</span>
                              {model.label ? (
                                <span className="text-[11px] text-stone-400">
                                  {model.label}
                                </span>
                              ) : null}
                            </div>
                          </DropdownMenu.Item>
                        ))}
                      </div>
                    );
                  })}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <p className="mt-1.5 text-[12px] text-stone-400">
              {defaultModelUiState?.helperText ?? "请先添加一个可用模型。"}
            </p>
          </div>
        </div>
      </div>

      <ImageCapabilityOverrides providers={providers} />

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
          <div className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200/60 divide-y divide-stone-100/80 shadow-sm shadow-stone-200/20">
            {providers.map((provider) => {
              const isCardBusy = activeCardActionId === provider.id;
              const enabledModelCount = provider.models.filter((model) => model.enabled).length;
              const presetLabel = resolveProviderPreset(provider).label;

              return (
                <div key={provider.id} className={cn(
                  "group relative flex min-h-[78px] items-center justify-between px-5 py-3.5 transition-colors",
                  "hover:bg-stone-50/60"
                )}>
                  <div className="flex min-w-0 flex-1 items-center gap-3.5">
                    <ProviderIcon provider={provider} className="h-9 w-9 rounded-[9px]" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex min-w-0 items-center">
                        <span className="truncate text-[14.5px] font-semibold tracking-tight text-stone-900">
                          {provider.name}
                        </span>
                      </div>

                      <p className="truncate text-[12px] text-stone-500">
                        {presetLabel} · {enabledModelCount} 个模型已启用
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 pl-4">
                    <button
                      type="button"
                      aria-label={`编辑 ${provider.name}`}
                      title="编辑配置"
                      disabled={isCardBusy}
                      onClick={() => openEditForm(provider)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-50"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${provider.name}`}
                      disabled={isCardBusy}
                      onClick={() => void requestDeleteProvider(provider)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-30"
                      title="删除配置"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <span className="ml-1 flex items-center">
                      <CompactSwitch
                        enabled={provider.enabled}
                        label={`${provider.enabled ? "停用" : "启用"} Provider ${provider.name}`}
                        title={provider.enabled ? "停用配置" : "启用配置"}
                        disabled={isCardBusy}
                        onChange={() => void handleToggleProvider(provider)}
                      />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {formMode ? createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-stone-900/24 p-3 backdrop-blur-sm animate-in fade-in duration-200 sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isFormBusy) {
              closeForm();
            }
          }}
        >
          <div
            className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-[620px] flex-col overflow-hidden rounded-[22px] bg-[#fffdf9] shadow-2xl shadow-stone-950/20 ring-1 ring-black/5 animate-in zoom-in-95 slide-in-from-bottom-4 duration-200 sm:max-h-[calc(100vh-2rem)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby={DIALOG_TITLE_ID}
          >
            <div className="flex items-start justify-between border-b border-stone-100 px-6 py-4">
              <div className="min-w-0">
                <h3 id={DIALOG_TITLE_ID} className="text-[16px] font-semibold tracking-tight text-stone-900">
                  {formMode.type === "edit" ? "编辑模型配置" : "新增模型配置"}
                </h3>
              </div>
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

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
              <div className="flex flex-col gap-5">
                <section className="space-y-0">
                  <div className="mb-2">
                    <h4 className="text-[13px] font-semibold text-stone-800">连接信息</h4>
                  </div>
                  <FormRow
                    label="配置名称"
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
                      placeholder="例如：工作模型"
                      disabled={isTestingConnection}
                      aria-invalid={Boolean(fieldErrors.name)}
                      aria-describedby={fieldErrors.name ? "provider-name-message" : undefined}
                    />
                  </FormRow>
                  
                  <FormRow label="服务与接口">
                    <select
                      className={cn(inputClassName, "cursor-pointer appearance-none")}
                      value={formState.presetId}
                      onChange={(e) => {
                        const preset = PROVIDER_PRESETS[e.target.value as ProviderPresetId];
                        updateFormState((current) => ({
                          ...current,
                          presetId: preset.id,
                          providerType: preset.providerType,
                          protocol: preset.protocol,
                          baseUrl: preset.defaultUrl,
                        }));
                      }}
                      disabled={isTestingConnection}
                    >
                      {Object.values(PROVIDER_PRESETS).map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                      ))}
                    </select>
                  </FormRow>

                  <FormRow
                    label="接口协议"
                    helperText={
                      formState.presetId === "custom"
                        ? "协议必须与接口地址提供的 API 兼容。"
                        : "由所选服务预设确定。"
                    }
                  >
                    <select
                      className={cn(inputClassName, "cursor-pointer appearance-none")}
                      value={formState.protocol}
                      onChange={(e) =>
                        updateFormState((current) => ({
                          ...current,
                          protocol: e.target.value as ProviderProtocol,
                        }))
                      }
                      disabled={isTestingConnection || formState.presetId !== "custom"}
                    >
                      <option value="anthropic-messages">Anthropic Messages</option>
                      <option value="openai-completions">OpenAI Chat Completions</option>
                    </select>
                  </FormRow>
                  
                  <FormRow
                    label="接口地址"
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
                    label="密钥"
                    required={!isEditing}
                    helperText={
                      fieldErrors.apiKey ??
                      (isEditing
                        ? "不填写则继续使用已保存的密钥。"
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
                        placeholder={isEditing ? "保留或替换密钥" : "粘贴服务商密钥"}
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
                        aria-label={showApiKey ? "隐藏密钥" : "显示密钥"}
                        className="absolute right-2 flex h-6 w-6 items-center justify-center text-stone-400 hover:text-stone-700 disabled:opacity-50"
                      >
                        {isLoadingApiKey ? (
                          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        ) : (
                          <VisibilityIcon visible={showApiKey} />
                        )}
                      </button>
                    </div>
                  </FormRow>

                </section>

                <section className="border-t border-stone-100 pt-4">
                  <div className="mb-3">
                    <h4 className="text-[13px] font-semibold text-stone-800">已启用模型</h4>
                  </div>
                  <div className="space-y-2">
                    {formState.models.filter((model) => model.enabled).length === 0 ? (
                      <p className="rounded-[8px] border border-dashed border-stone-200 px-3 py-4 text-center text-[12px] text-stone-400">
                        暂无已启用模型
                      </p>
                    ) : (
                      formState.models.filter((model) => model.enabled).map((model) => (
                        <div key={model.id} className="flex items-center gap-3 rounded-[8px] border border-stone-200/80 bg-white/60 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] font-medium text-stone-800">{model.name ?? model.id}</p>
                            {model.name ? <p className="truncate font-mono text-[11px] text-stone-400">{model.id}</p> : null}
                            {modelTestStates[model.id]?.status === "error" ? (
                              <p
                                className="mt-1 line-clamp-2 text-[11px] leading-4 text-rose-600"
                                title={modelTestStates[model.id]?.message}
                              >
                                {formatProviderTestError(modelTestStates[model.id]?.message ?? "")}
                              </p>
                            ) : null}
                          </div>
                          {modelTestStates[model.id] ? (
                            <ModelTestIndicator
                              state={modelTestStates[model.id]}
                              modelName={model.name ?? model.id}
                            />
                          ) : null}
                          <div className="flex shrink-0 items-center gap-1.5">
                            <ModelEnabledControl
                              enabled
                              modelName={model.name ?? model.id}
                              disabled={isTestingConnection}
                              onChange={(enabled) => handleSetModelEnabled(model.id, enabled)}
                            />
                            <DeleteModelButton
                              modelName={model.name ?? model.id}
                              disabled={isTestingConnection}
                              onDelete={() => void requestDeleteModel(model)}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-5 border-t border-stone-100 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-[13px] font-semibold text-stone-800">可用模型</h4>
                      <Button type="button" variant="secondary" onClick={() => void handleFetchModels()} disabled={isFetchingModels || isTestingConnection} className="h-8 rounded-[8px] px-3 text-[12px]">
                        {isFetchingModels ? "获取中" : "从 Provider 获取"}
                      </Button>
                    </div>
                    {availableModels.length >= 8 ? (
                      <input
                        className={cn(inputClassName, "mt-2")}
                        value={availableModelQuery}
                        onChange={(event) => setAvailableModelQuery(event.target.value)}
                        placeholder="筛选可用模型"
                        disabled={isFetchingModels}
                      />
                    ) : null}
                    <div className="mt-2 space-y-2">
                      {visibleAvailableModels.map((model) => (
                        <div key={model.id} className="flex items-center gap-3 rounded-[8px] border border-stone-200/80 bg-white/40 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] font-medium text-stone-700">{model.name ?? model.id}</p>
                            {model.name ? <p className="truncate font-mono text-[11px] text-stone-400">{model.id}</p> : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <ModelEnabledControl
                              enabled={false}
                              modelName={model.name ?? model.id}
                              disabled={isTestingConnection || isFetchingModels}
                              onChange={(enabled) => handleSetModelEnabled(model.id, enabled)}
                            />
                            <DeleteModelButton
                              modelName={model.name ?? model.id}
                              disabled={isTestingConnection || isFetchingModels}
                              onDelete={() => void requestDeleteModel(model)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                      <input className={technicalInputClassName} value={formState.manualModelId} onChange={(event) => updateField("manualModelId", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleAddManualModel(); }} placeholder="模型 ID" disabled={isTestingConnection || isFetchingModels} />
                      <input className={inputClassName} value={formState.manualModelName} onChange={(event) => updateField("manualModelName", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleAddManualModel(); }} placeholder="显示名称（可选）" disabled={isTestingConnection || isFetchingModels} />
                      <Button type="button" variant="secondary" onClick={handleAddManualModel} disabled={isTestingConnection || isFetchingModels} className="h-9 rounded-[8px] px-4 text-[12.5px]">
                        添加
                      </Button>
                    </div>
                    {manualModelError ? (
                      <p className="mt-1.5 text-[11px] text-rose-600" role="alert">
                        {manualModelError}
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>

            </div>

            <div className="shrink-0 border-t border-stone-100 bg-[#fffdf9] px-6 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant={isTestingConnection ? "danger" : "secondary"}
                    onClick={() =>
                      void (isTestingConnection ? handleStopConnectionTest() : handleTestConnection())
                    }
                    disabled={
                      isTestingConnection
                        ? false
                        : !canTestConnection || isSaving || isFetchingModels
                    }
                    className={cn(
                      "h-9 w-full rounded-[10px] px-4 text-[13px] font-medium sm:w-auto",
                      !isTestingConnection &&
                        "border-stone-200/80 bg-white/70 text-stone-600 shadow-none hover:bg-stone-50 hover:text-stone-800 disabled:bg-white/50"
                    )}
                  >
                    {isTestingConnection ? "停止测试" : "测试连接"}
                  </Button>
                  {connectionSummary ? (
                    <span
                      role="status"
                      className={cn(
                        "text-[12px] font-medium",
                        connectionSummary.tone === "success"
                          ? "text-emerald-600"
                          : connectionSummary.tone === "error"
                            ? "text-rose-600"
                            : "text-stone-500"
                      )}
                    >
                      {connectionSummary.message}
                    </span>
                  ) : null}
                </div>

                <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={closeForm}
                    disabled={isFormBusy}
                    className="h-9 flex-1 rounded-[10px] px-4 text-[13px] font-medium text-stone-600 hover:bg-stone-100/70 sm:flex-none"
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={isFormBusy}
                    className="h-9 min-w-[76px] flex-1 rounded-[10px] px-5 text-[13px] font-semibold shadow-none hover:shadow-none sm:flex-none"
                  >
                    {isSaving ? "保存中" : "保存"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
      {deleteConfirmation ? createPortal(
        <div
          className="fixed inset-0 z-[180] flex items-center justify-center bg-stone-950/25 px-4 backdrop-blur-[1px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDeleteConfirmation(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-delete-title"
            className="w-full max-w-[390px] rounded-2xl bg-white p-5 shadow-2xl shadow-stone-900/15 ring-1 ring-stone-200/70"
          >
            <h3 id="provider-delete-title" className="text-[16px] font-semibold text-stone-900">
              {deleteConfirmation.kind === "provider" ? "删除模型配置" : "删除模型"}
            </h3>
            <p className="mt-2 text-[13.5px] leading-6 text-stone-700">
              确认删除“{deleteConfirmation.name}”吗？
            </p>
            {deleteConfirmation.inUse ? (
              <p className="mt-1 text-[12px] leading-5 text-stone-500">
                {deleteConfirmation.kind === "provider"
                  ? "该 Provider 下有模型正在使用，删除后需要重新配置模型。"
                  : "该模型正在使用，删除后需要重新配置模型。"}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDeleteConfirmation(null)}
                className="h-9 rounded-[9px] px-4 text-[13px]"
              >
                取消
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => void confirmDeletion()}
                className="h-9 rounded-[9px] px-4 text-[13px]"
              >
                删除
              </Button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </section>
  );
}
