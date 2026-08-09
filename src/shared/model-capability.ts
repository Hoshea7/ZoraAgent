import type { ProviderType } from "./types/provider";
import type {
  ImageInputCapability,
  ModelCapabilityOverride,
  ModelIdentity,
} from "./types/vision";

export interface ModelCatalogEntry {
  providerId: string;
  modelId: string;
  input: readonly ("text" | "image")[];
}

interface ModelCapabilityResolverOptions {
  overrides?: readonly ModelCapabilityOverride[];
  catalog?: readonly ModelCatalogEntry[];
}

const CATALOG_PROVIDER_BY_TYPE: Partial<Record<ProviderType, readonly string[]>> = {
  anthropic: ["anthropic"],
  openai: ["openai"],
  deepseek: ["deepseek"],
  moonshot: ["moonshot", "kimi-coding"],
  zhipu: ["zhipu", "zai"],
  volcengine: ["volcengine"],
};

const MAINTAINED_IMAGE_MODELS = new Set([
  "claude-3-5-haiku-20241022",
  "claude-3-5-sonnet-20240620",
  "claude-3-5-sonnet-20241022",
  "claude-3-7-sonnet-20250219",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-20250514",
  "claude-opus-4-1-20250805",
  "claude-opus-4-5-20251101",
  "claude-opus-4-6",
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-6",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "o3",
  "o4-mini",
]);

export class ModelCapabilityResolver {
  private readonly overrides: readonly ModelCapabilityOverride[];
  private readonly catalog: readonly ModelCatalogEntry[];

  constructor(options: ModelCapabilityResolverOptions = {}) {
    this.overrides = options.overrides ?? [];
    this.catalog = options.catalog ?? [];
  }

  resolve(
    identity: ModelIdentity,
    provider: { providerType: ProviderType }
  ): ImageInputCapability {
    const override = this.overrides.find(
      (entry) =>
        entry.providerId === identity.providerId && entry.modelId === identity.modelId
    );
    if (override) return override.capability;

    const catalogProviderIds = CATALOG_PROVIDER_BY_TYPE[provider.providerType] ?? [];
    const catalogEntry = this.catalog.find(
      (entry) =>
        catalogProviderIds.includes(entry.providerId) && entry.modelId === identity.modelId
    );
    if (catalogEntry) {
      return catalogEntry.input.includes("image") ? "supported" : "unsupported";
    }

    if (MAINTAINED_IMAGE_MODELS.has(identity.modelId)) return "supported";
    return "unknown";
  }
}
