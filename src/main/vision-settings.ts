import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProviderModelId } from "../shared/provider-model";
import { resolveProviderProtocol } from "../shared/provider-protocol";
import type { ProviderConfig } from "../shared/types/provider";
import {
  DEFAULT_VISION_SETTINGS,
  type ConfiguredModelCapability,
  type ModelCapabilityOverride,
  type ProviderModelTarget,
  type VisionSettings,
} from "../shared/types/vision";
import { providerManager } from "./provider-manager";
import { createRuntimeModelCapabilityResolver } from "./model-capability-service";
import { ZORA_DIR } from "./utils/fs";
import { isRecord } from "./utils/guards";
import { normalizeOptionalString } from "./utils/validate";

type ProviderLookup = (
  providerId: string
) => Promise<{ provider: ProviderConfig; apiKey: string } | null>;
type ProviderList = () => Promise<ProviderConfig[]>;

function configuredModelIds(provider: ProviderConfig): string[] {
  return [...new Set([
    provider.modelId,
    provider.roleModels?.sonnetModel,
    provider.roleModels?.opusModel,
    provider.roleModels?.haikuModel,
    provider.roleModels?.smallFastModel,
  ].map(normalizeOptionalString).filter((value): value is string => Boolean(value)))];
}

function normalizeOverrides(value: unknown): ModelCapabilityOverride[] {
  if (!Array.isArray(value)) return [];
  const result: ModelCapabilityOverride[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const providerId = normalizeOptionalString(entry.providerId);
    const modelId = normalizeOptionalString(entry.modelId);
    const capability = entry.capability;
    if (
      providerId &&
      modelId &&
      (capability === "supported" || capability === "unsupported")
    ) {
      const duplicateIndex = result.findIndex(
        (item) => item.providerId === providerId && item.modelId === modelId
      );
      const normalized: ModelCapabilityOverride = {
        providerId,
        modelId,
        capability,
      };
      if (duplicateIndex >= 0) result[duplicateIndex] = normalized;
      else result.push(normalized);
    }
  }
  return result;
}

export function normalizeVisionSettings(value: unknown): VisionSettings {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_VISION_SETTINGS);
  }
  const relayValue = isRecord(value.relay) ? value.relay : {};
  const enabled = relayValue.enabled === true;
  const providerId = normalizeOptionalString(relayValue.providerId);
  const modelId = normalizeOptionalString(relayValue.modelId);
  return {
    relay:
      enabled && providerId && modelId
        ? { enabled: true, providerId, modelId }
        : { enabled: false },
    capabilityOverrides: normalizeOverrides(value.capabilityOverrides),
  };
}

export class VisionSettingsStore {
  private cached: VisionSettings | null = null;

  constructor(
    private readonly settingsPath = path.join(ZORA_DIR, "vision-settings.json"),
    private readonly lookupProvider: ProviderLookup = (providerId) =>
      providerManager.getProviderByIdWithKey(providerId),
    private readonly listProviders: ProviderList = () => providerManager.list()
  ) {}

  async load(): Promise<VisionSettings> {
    if (this.cached) return structuredClone(this.cached);
    try {
      this.cached = normalizeVisionSettings(
        JSON.parse(await readFile(this.settingsPath, "utf8"))
      );
    } catch {
      this.cached = structuredClone(DEFAULT_VISION_SETTINGS);
    }
    return structuredClone(this.cached);
  }

  async save(value: VisionSettings): Promise<VisionSettings> {
    const normalized = normalizeVisionSettings(value);
    if (normalized.relay.enabled) {
      await this.resolveValidatedTarget(normalized);
    }
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(normalized, null, 2), "utf8");
    this.cached = normalized;
    return structuredClone(normalized);
  }

  async resolveRoute(): Promise<ProviderModelTarget | null> {
    const settings = await this.load();
    if (!settings.relay.enabled) return null;
    return this.resolveValidatedTarget(settings);
  }

  async listConfiguredModelCapabilities(): Promise<ConfiguredModelCapability[]> {
    const settings = await this.load();
    const resolver = await createRuntimeModelCapabilityResolver(
      settings.capabilityOverrides
    );
    const providers = await this.listProviders();
    return providers
      .filter((provider) => provider.enabled)
      .flatMap((provider) =>
        configuredModelIds(provider).map((modelId) => ({
          providerId: provider.id,
          modelId,
          capability: resolver.resolve(
            { providerId: provider.id, modelId },
            { providerType: provider.providerType }
          ),
        }))
      );
  }

  private async resolveValidatedTarget(
    settings: VisionSettings
  ): Promise<ProviderModelTarget> {
    const { providerId, modelId } = settings.relay;
    if (!settings.relay.enabled || !providerId || !modelId) {
      throw new Error("VISION_NOT_CONFIGURED");
    }
    const configured = await this.lookupProvider(providerId);
    if (!configured) throw new Error("VISION_PROVIDER_NOT_FOUND");
    if (!configured.provider.enabled) throw new Error("VISION_PROVIDER_DISABLED");
    if (!normalizeOptionalString(configured.apiKey)) {
      throw new Error("VISION_PROVIDER_API_KEY_MISSING");
    }
    if (!normalizeOptionalString(configured.provider.baseUrl)) {
      throw new Error("VISION_PROVIDER_BASE_URL_MISSING");
    }
    if (resolveProviderModelId(configured.provider, modelId) !== modelId) {
      throw new Error("VISION_MODEL_NOT_CONFIGURED");
    }
    const capability = (await createRuntimeModelCapabilityResolver(
      settings.capabilityOverrides
    )).resolve(
      { providerId, modelId },
      { providerType: configured.provider.providerType }
    );
    if (capability !== "supported") {
      throw new Error("VISION_MODEL_IMAGE_CAPABILITY_UNCONFIRMED");
    }
    return {
      providerId,
      providerType: configured.provider.providerType,
      protocol: resolveProviderProtocol(configured.provider),
      baseUrl: configured.provider.baseUrl,
      apiKey: configured.apiKey,
      modelId,
    };
  }
}

export const visionSettingsStore = new VisionSettingsStore();
