import type { AgentRuntimeType } from "../../shared/types/provider";
import type {
  ImageInputCapability,
  RuntimeProjectionFingerprint,
} from "../../shared/types/vision";

export const RUNTIME_PROMPT_PROJECTION_VERSION = 2;

export function createRuntimeProjectionFingerprint(input: {
  runtime: AgentRuntimeType;
  providerId: string;
  modelId: string;
  imageInputCapability: ImageInputCapability;
  contextWindow: number;
  promptProjectionVersion?: number;
}): RuntimeProjectionFingerprint {
  return {
    ...input,
    promptProjectionVersion:
      input.promptProjectionVersion ?? RUNTIME_PROMPT_PROJECTION_VERSION,
  };
}

export function hasRuntimeProjectionChanged(
  current: RuntimeProjectionFingerprint | undefined,
  next: RuntimeProjectionFingerprint
): boolean {
  return (
    !current ||
    current.runtime !== next.runtime ||
    current.providerId !== next.providerId ||
    current.modelId !== next.modelId ||
    current.imageInputCapability !== next.imageInputCapability ||
    current.contextWindow !== next.contextWindow ||
    current.promptProjectionVersion !== next.promptProjectionVersion
  );
}
