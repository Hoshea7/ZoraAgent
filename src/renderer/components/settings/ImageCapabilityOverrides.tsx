import { useEffect, useMemo, useState } from "react";
import type { ProviderConfig } from "../../../shared/types/provider";
import type {
  ImageInputCapability,
  VisionSettings,
} from "../../../shared/types/vision";
import { getProviderModels } from "../../utils/provider-selection";
import { getErrorMessage } from "../../utils/message";

type OverrideValue = "auto" | Exclude<ImageInputCapability, "unknown">;

export function ImageCapabilityOverrides({
  providers,
}: {
  providers: ProviderConfig[];
}) {
  const [settings, setSettings] = useState<VisionSettings | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const configuredModels = useMemo(
    () => providers.flatMap((provider) =>
      getProviderModels(provider).map((model) => ({
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.modelId,
      }))
    ),
    [providers]
  );

  useEffect(() => {
    void window.zora.vision.getSettings()
      .then(setSettings)
      .catch((error) => setErrorMessage(getErrorMessage(error)));
  }, []);

  const updateCapability = async (
    providerId: string,
    modelId: string,
    capability: OverrideValue
  ) => {
    if (!settings) return;
    const key = `${providerId}:${modelId}`;
    const remaining = settings.capabilityOverrides.filter(
      (entry) => entry.providerId !== providerId || entry.modelId !== modelId
    );
    const next: VisionSettings = {
      ...settings,
      capabilityOverrides:
        capability === "auto"
          ? remaining
          : [...remaining, { providerId, modelId, capability }],
    };
    setSavingKey(key);
    setErrorMessage(null);
    try {
      setSettings(await window.zora.vision.updateSettings(next));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSavingKey(null);
    }
  };

  if (configuredModels.length === 0) return null;

  return (
    <details className="mb-5 rounded-2xl border border-stone-200/70 bg-white">
      <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-medium text-stone-700">
        图片能力识别
        <span className="ml-2 text-[11.5px] font-normal text-stone-400">
          仅在自动识别不准确时调整
        </span>
      </summary>
      <div className="border-t border-stone-100 px-4 py-2">
        {configuredModels.map((model) => {
          const key = `${model.providerId}:${model.modelId}`;
          const value: OverrideValue =
            settings?.capabilityOverrides.find(
              (entry) =>
                entry.providerId === model.providerId &&
                entry.modelId === model.modelId
            )?.capability ?? "auto";
          return (
            <label
              key={key}
              className="flex items-center justify-between gap-4 border-b border-stone-100 py-2.5 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-stone-700">
                  {model.modelId}
                </span>
                <span className="block truncate text-[11px] text-stone-400">
                  {model.providerName}
                </span>
              </span>
              <select
                aria-label={`${model.providerName} ${model.modelId} 图片能力`}
                value={value}
                disabled={!settings || savingKey === key}
                onChange={(event) =>
                  void updateCapability(
                    model.providerId,
                    model.modelId,
                    event.target.value as OverrideValue
                  )
                }
                className="h-8 rounded-lg border border-stone-200 bg-white px-2 text-[12px] text-stone-600 outline-none focus:border-stone-300"
              >
                <option value="auto">自动识别</option>
                <option value="supported">支持图片</option>
                <option value="unsupported">不支持图片</option>
              </select>
            </label>
          );
        })}
        {errorMessage ? (
          <p className="py-2 text-[12px] text-rose-600" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </details>
  );
}
