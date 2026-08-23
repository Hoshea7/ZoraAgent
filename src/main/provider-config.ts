import type {
  ProviderConfig,
  ProviderModel,
  ProviderProtocol,
  ProviderType,
} from "../shared/types/provider";
import {
  isProviderPresetId,
  PROVIDER_PRESETS,
} from "../shared/provider-presets";

export const PROVIDER_CONFIG_VERSION = 2;

export interface ProviderConfigFile {
  version: typeof PROVIDER_CONFIG_VERSION;
  providers: ProviderConfig[];
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

function parseProviderModel(value: unknown, field: string): ProviderModel {
  if (!isRecord(value)) {
    throw new Error(`Provider config file is malformed: ${field}.`);
  }
  if (typeof value.enabled !== "boolean") {
    throw new Error(`Provider config file is malformed: ${field}.enabled.`);
  }
  return {
    id: requiredString(value.id, `${field}.id`),
    name: optionalString(value.name),
    enabled: value.enabled,
    contextWindow: optionalPositiveInteger(
      value.contextWindow,
      `${field}.contextWindow`
    ),
    maxTokens: optionalPositiveInteger(value.maxTokens, `${field}.maxTokens`),
  };
}

export function parseProviderModels(
  value: unknown,
  field = "provider.models"
): ProviderModel[] {
  if (!Array.isArray(value)) {
    throw new Error(`Provider config file is malformed: ${field}.`);
  }
  const models = value.map((model, index) =>
    parseProviderModel(model, `${field}.${index}`)
  );
  const ids = new Set(models.map((model) => model.id));
  if (ids.size !== models.length) {
    throw new Error(`Provider config file is malformed: ${field} has duplicate IDs.`);
  }
  return models;
}

function parseProtocol(value: unknown): ProviderProtocol {
  if (value !== "anthropic-messages" && value !== "openai-completions") {
    throw new Error("Provider config file is malformed: provider.protocol.");
  }
  return value;
}

function normalizeProvider(value: unknown): ProviderConfig {
  if (!isRecord(value)) {
    throw new Error("Provider config file is malformed: provider.");
  }
  const presetId = requiredString(value.presetId, "provider.presetId");
  if (!isProviderPresetId(presetId)) {
    throw new Error("Provider config file is malformed: provider.presetId.");
  }
  const providerType = requiredString(
    value.providerType,
    "provider.providerType"
  ) as ProviderType;
  const protocol = parseProtocol(value.protocol);
  const preset = PROVIDER_PRESETS[presetId];
  if (
    preset.providerType !== providerType ||
    (preset.id !== "custom" && preset.protocol !== protocol)
  ) {
    throw new Error("Provider config file is malformed: provider preset mismatch.");
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
    providerType,
    baseUrl: requiredString(value.baseUrl, "provider.baseUrl"),
    apiKey: requiredString(value.apiKey, "provider.apiKey"),
    models: parseProviderModels(value.models),
    presetId,
    protocol,
    enabled: value.enabled,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseProviderConfigFile(value: unknown): ProviderConfigFile {
  if (
    !isRecord(value) ||
    value.version !== PROVIDER_CONFIG_VERSION ||
    !Array.isArray(value.providers)
  ) {
    throw new Error("Provider config file is malformed.");
  }
  return {
    version: PROVIDER_CONFIG_VERSION,
    providers: value.providers.map(normalizeProvider),
  };
}
