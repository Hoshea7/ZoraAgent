import type { AgentRuntimeType } from "../../shared/types/provider";
import type {
  ImageInputCapability,
  RuntimeProjectionFingerprint,
} from "../../shared/types/vision";

export function createRuntimeProjectionFingerprint(input: {
  runtime: AgentRuntimeType;
  providerId: string;
  modelId: string;
  imageInputCapability: ImageInputCapability;
}): RuntimeProjectionFingerprint {
  return { ...input };
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
    current.imageInputCapability !== next.imageInputCapability
  );
}
