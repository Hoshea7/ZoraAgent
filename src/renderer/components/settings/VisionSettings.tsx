import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { ModelCapabilityResolver } from "../../../shared/model-capability";
import type {
  ModelCapabilityOverride,
  VisionSettings as VisionSettingsValue,
} from "../../../shared/types/vision";
import { providersAtom } from "../../store/provider";
import { getProviderModels } from "../../utils/provider-selection";

export function VisionSettings() {
  const providers = useAtomValue(providersAtom);
  const [settings, setSettings] = useState<VisionSettingsValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<ModelCapabilityOverride>({
    providerId: "",
    modelId: "",
    capability: "supported",
  });

  useEffect(() => {
    void window.zora.vision.getSettings().then(setSettings).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  const supportedTargets = useMemo(() => {
    if (!settings) return [];
    const resolver = new ModelCapabilityResolver({
      overrides: settings.capabilityOverrides,
    });
    return providers
      .filter((provider) => provider.enabled)
      .flatMap((provider) =>
        getProviderModels(provider).flatMap(({ modelId }) =>
          resolver.resolve(
            { providerId: provider.id, modelId },
            { providerType: provider.providerType }
          ) === "supported"
            ? [{ provider, modelId }]
            : []
        )
      );
  }, [providers, settings]);

  if (!settings) {
    return <p className="text-sm text-stone-500">正在加载视觉助手设置…</p>;
  }

  const selectedValue = settings.relay.enabled
    ? `${settings.relay.providerId}\0${settings.relay.modelId}`
    : "";
  const routeAvailable =
    !settings.relay.enabled ||
    supportedTargets.some(
      ({ provider, modelId }) =>
        provider.id === settings.relay.providerId && modelId === settings.relay.modelId
    );

  const save = async (next: VisionSettingsValue) => {
    setError(null);
    try {
      setSettings(await window.zora.vision.updateSettings(next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-stone-900">视觉助手</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          启用后，Agent 会在需要时把当前会话已登记的单张图片发送到所选 Provider 和模型。请求不包含完整对话历史和本地路径。
        </p>
      </div>

      <div className="rounded-xl border border-stone-200 p-5">
        <label className="flex items-center justify-between gap-4 text-sm font-medium">
          启用视觉中转
          <input
            type="checkbox"
            checked={settings.relay.enabled}
            onChange={(event) => {
              if (!event.target.checked) {
                void save({ ...settings, relay: { enabled: false } });
                return;
              }
              const target = supportedTargets[0];
              if (target) {
                void save({
                  ...settings,
                  relay: {
                    enabled: true,
                    providerId: target.provider.id,
                    modelId: target.modelId,
                  },
                });
              }
            }}
            disabled={!settings.relay.enabled && supportedTargets.length === 0}
          />
        </label>

        <label className="mt-5 block text-sm font-medium text-stone-700">
          视觉模型
          <select
            className="mt-2 w-full rounded-lg border border-stone-200 bg-white px-3 py-2"
            value={selectedValue}
            onChange={(event) => {
              const [providerId, modelId] = event.target.value.split("\0");
              void save({
                ...settings,
                relay: providerId && modelId
                  ? { enabled: true, providerId, modelId }
                  : { enabled: false },
              });
            }}
          >
            <option value="">关闭</option>
            {supportedTargets.map(({ provider, modelId }) => (
              <option key={`${provider.id}:${modelId}`} value={`${provider.id}\0${modelId}`}>
                {provider.name} · {modelId}
              </option>
            ))}
          </select>
        </label>

        <p className="mt-4 text-xs leading-5 text-stone-500">
          单张图片上限为 10MB 和 2000 万像素，观察指令上限为 1000 字符。图片会先在本机规范化，仅发送规范化图片和单条观察指令。
        </p>
        {!routeAvailable ? (
          <p className="mt-3 text-sm text-red-600">
            当前视觉路由已失效。Provider、模型或能力设置已经变化，请重新选择。
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-stone-200 p-5">
        <h3 className="text-sm font-semibold">模型能力覆盖</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <input
            aria-label="Provider ID"
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
            placeholder="Provider ID"
            value={override.providerId}
            onChange={(event) => setOverride({ ...override, providerId: event.target.value })}
          />
          <input
            aria-label="Model ID"
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
            placeholder="Model ID"
            value={override.modelId}
            onChange={(event) => setOverride({ ...override, modelId: event.target.value })}
          />
          <select
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm"
            value={override.capability}
            onChange={(event) => setOverride({
              ...override,
              capability: event.target.value as ModelCapabilityOverride["capability"],
            })}
          >
            <option value="supported">支持图片</option>
            <option value="unsupported">不支持图片</option>
          </select>
        </div>
        <button
          type="button"
          className="mt-3 rounded-lg bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-40"
          disabled={!override.providerId.trim() || !override.modelId.trim()}
          onClick={() => {
            const next = settings.capabilityOverrides.filter(
              (item) => item.providerId !== override.providerId.trim() || item.modelId !== override.modelId.trim()
            );
            void save({
              ...settings,
              capabilityOverrides: [...next, {
                providerId: override.providerId.trim(),
                modelId: override.modelId.trim(),
                capability: override.capability,
              }],
            });
          }}
        >
          保存覆盖
        </button>
        <ul className="mt-4 space-y-2 text-sm text-stone-600">
          {settings.capabilityOverrides.map((item) => (
            <li key={`${item.providerId}:${item.modelId}`} className="flex justify-between gap-4">
              <span>{item.providerId} · {item.modelId} · {item.capability}</span>
              <button
                type="button"
                className="text-stone-500 underline"
                onClick={() => void save({
                  ...settings,
                  capabilityOverrides: settings.capabilityOverrides.filter(
                    (entry) => entry.providerId !== item.providerId || entry.modelId !== item.modelId
                  ),
                })}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
