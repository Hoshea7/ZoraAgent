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
  contextWindow?: number;
}

interface ModelCapabilityResolverOptions {
  overrides?: readonly ModelCapabilityOverride[];
  catalog?: readonly ModelCatalogEntry[];
}

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
  "doubao-seed-2-1-pro-260628",
  "doubao-seed-evolving",
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
    _provider: { providerType: ProviderType }
  ): ImageInputCapability {
    const override = this.overrides.find(
      (entry) =>
        entry.providerId === identity.providerId && entry.modelId === identity.modelId
    );
    if (override) return override.capability;

    if (MAINTAINED_IMAGE_MODELS.has(identity.modelId)) return "supported";

    const catalogEntries = this.catalog.filter(
      (entry) => entry.modelId === identity.modelId
    );
    if (catalogEntries.some((entry) => entry.input.includes("image"))) {
      return "supported";
    }
    if (catalogEntries.length > 0) return "unsupported";
    return "unknown";
  }

  resolveContextWindow(modelId: string): number | undefined {
    const windows = this.catalog
      .filter((entry) => entry.modelId === modelId)
      .map((entry) => entry.contextWindow)
      .filter(
        (contextWindow): contextWindow is number =>
          typeof contextWindow === "number" &&
          Number.isFinite(contextWindow) &&
          contextWindow > 0
      );

    return windows.length > 0 ? Math.max(...windows) : undefined;
  }
}
