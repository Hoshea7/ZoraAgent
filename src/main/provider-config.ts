import type {
  ProviderConfig,
  ProviderModel,
  ProviderProtocol,
  ProviderType,
} from "../shared/types/provider";

export const PROVIDER_CONFIG_VERSION = 2;

export interface ProviderConfigFile {
  version: typeof PROVIDER_CONFIG_VERSION;
  providers: ProviderConfig[];
}

interface LegacyRoleModels {
  sonnetModel?: unknown;
  opusModel?: unknown;
  haikuModel?: unknown;
  smallFastModel?: unknown;
}

interface LegacyProviderConfig extends Omit<ProviderConfig, "models"> {
  modelId?: unknown;
  roleModels?: LegacyRoleModels;
  contextWindow?: unknown;
  isDefault?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Provider config file is malformed: ${field}.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Provider config file is malformed: ${field}.`);
  }
  return Math.floor(value);
}

function normalizeModel(value: unknown): ProviderModel {
  if (!isRecord(value)) {
    throw new Error("Provider config file is malformed: model.");
  }
  if (typeof value.enabled !== "boolean") {
    throw new Error("Provider config file is malformed: model.enabled.");
  }
  return {
    id: requiredString(value.id, "model.id"),
    name: optionalString(value.name),
    enabled: value.enabled,
    contextWindow: optionalPositiveInteger(value.contextWindow, "model.contextWindow"),
    maxTokens: optionalPositiveInteger(value.maxTokens, "model.maxTokens"),
  };
}

function normalizeProvider(value: unknown): ProviderConfig {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    throw new Error("Provider config file is malformed: provider.");
  }
  const models = value.models.map(normalizeModel);
  const ids = new Set(models.map((model) => model.id));
  if (ids.size !== models.length) {
    throw new Error("Provider config file is malformed: duplicate model ID.");
  }
  if (typeof value.enabled !== "boolean") {
    throw new Error("Provider config file is malformed: provider state.");
  }
  if (typeof value.createdAt !== "number" || typeof value.updatedAt !== "number") {
    throw new Error("Provider config file is malformed: timestamps.");
  }
  return {
    id: requiredString(value.id, "provider.id"),
    name: requiredString(value.name, "provider.name"),
    providerType: requiredString(value.providerType, "provider.providerType") as ProviderType,
    baseUrl: requiredString(value.baseUrl, "provider.baseUrl"),
    apiKey: requiredString(value.apiKey, "provider.apiKey"),
    models,
    presetId: optionalString(value.presetId) as ProviderConfig["presetId"],
    protocol: optionalString(value.protocol) as ProviderProtocol | undefined,
    enabled: value.enabled,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function migrateLegacyProvider(value: unknown): ProviderConfig {
  if (!isRecord(value)) {
    throw new Error("Provider config file is malformed: legacy provider.");
  }
  const legacy = value as unknown as LegacyProviderConfig;
  const contextWindow = optionalPositiveInteger(
    legacy.contextWindow,
    "provider.contextWindow"
  );
  const candidates = [
    legacy.modelId,
    legacy.roleModels?.sonnetModel,
    legacy.roleModels?.opusModel,
    legacy.roleModels?.haikuModel,
    legacy.roleModels?.smallFastModel,
  ];
  const ids = Array.from(
    new Set(candidates.map(optionalString).filter((id): id is string => Boolean(id)))
  );
  return normalizeProvider({
    ...value,
    models: ids.map((id) => ({ id, enabled: true, contextWindow })),
  });
}

export function migrateProviderConfigFile(value: unknown): {
  file: ProviderConfigFile;
  migrated: boolean;
} {
  if (Array.isArray(value)) {
    const legacyProviders = [...value].sort((left, right) => {
      const leftDefault = isRecord(left) && left.isDefault === true;
      const rightDefault = isRecord(right) && right.isDefault === true;
      return Number(rightDefault) - Number(leftDefault);
    });
    return {
      file: {
        version: PROVIDER_CONFIG_VERSION,
        providers: legacyProviders.map(migrateLegacyProvider),
      },
      migrated: true,
    };
  }
  if (
    !isRecord(value) ||
    value.version !== PROVIDER_CONFIG_VERSION ||
    !Array.isArray(value.providers)
  ) {
    throw new Error("Provider config file is malformed.");
  }
  return {
    file: {
      version: PROVIDER_CONFIG_VERSION,
      providers: value.providers.map(normalizeProvider),
    },
    migrated: false,
  };
}
