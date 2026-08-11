import type {
  AgentRuntimeType,
  ProviderProtocol,
  ProviderType,
} from "./provider";

export const INSPECT_IMAGE_CANONICAL_NAME =
  "mcp__zora_vision__inspect_image";

export type ImageInputCapability = "supported" | "unsupported" | "unknown";

export interface ModelIdentity {
  providerId: string;
  modelId: string;
}

export interface ModelCapabilityOverride extends ModelIdentity {
  capability: Exclude<ImageInputCapability, "unknown">;
}

export interface ProviderModelTarget {
  providerId: string;
  providerType: ProviderType;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

export type RunOrigin = "desktop" | "feishu" | "schedule" | "memory" | "delegation";

export interface VisionRunContext {
  imageInputCapability: ImageInputCapability;
  visionRelayEnabled: boolean;
}

export interface ToolRunContext extends VisionRunContext {
  workspaceId: string;
  sessionId: string;
  runtime: AgentRuntimeType;
  mainModel: ModelIdentity;
  runOrigin: RunOrigin;
}

export interface ToolCallContext extends ToolRunContext {
  signal: AbortSignal;
  agentId?: string;
}

export interface VisionRelaySettings {
  enabled: boolean;
  providerId?: string;
  modelId?: string;
}

export interface VisionSettings {
  relay: VisionRelaySettings;
  capabilityOverrides: ModelCapabilityOverride[];
}

export interface RuntimeProjectionFingerprint {
  runtime: AgentRuntimeType;
  providerId: string;
  modelId: string;
  imageInputCapability: ImageInputCapability;
  contextWindow: number;
  promptProjectionVersion: number;
}

export const DEFAULT_VISION_SETTINGS: VisionSettings = {
  relay: { enabled: false },
  capabilityOverrides: [],
};
