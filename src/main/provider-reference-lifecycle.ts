import type { ProviderReferenceImpact } from "../shared/types/provider";
import {
  loadDefaultModelSettings,
  saveDefaultModelSettings,
} from "./default-model-settings";
import { loadMemorySettings, saveMemorySettings } from "./memory-settings";
import { visionSettingsStore } from "./vision-settings";

export interface ProviderReferenceTarget {
  providerId: string;
  modelId?: string;
  modelIds?: readonly string[];
}

interface ProviderReferenceDetails extends ProviderReferenceImpact {
  defaultModel: boolean;
  memory: boolean;
  vision: boolean;
}

function matchesTarget(
  target: ProviderReferenceTarget,
  providerId: string | null | undefined,
  modelId: string | null | undefined
): boolean {
  if (providerId !== target.providerId) return false;
  if (target.modelId !== undefined) return modelId === target.modelId;
  if (target.modelIds !== undefined) {
    return modelId !== null && modelId !== undefined && target.modelIds.includes(modelId);
  }
  return true;
}

async function inspectProviderReferences(
  target: ProviderReferenceTarget
): Promise<ProviderReferenceDetails> {
  const [defaultModel, memory, vision] = await Promise.all([
    loadDefaultModelSettings(),
    loadMemorySettings(),
    visionSettingsStore.load(),
  ]);
  const defaultModelInUse = matchesTarget(
    target,
    defaultModel.defaultProviderId,
    defaultModel.defaultModelId
  );
  const memoryInUse = matchesTarget(
    target,
    memory.memoryProviderId,
    memory.memoryModelId
  );
  const visionInUse = vision.relay.enabled && matchesTarget(
    target,
    vision.relay.providerId,
    vision.relay.modelId
  );

  return {
    inUse: defaultModelInUse || memoryInUse || visionInUse,
    defaultModel: defaultModelInUse,
    memory: memoryInUse,
    vision: visionInUse,
  };
}

export async function getProviderReferenceImpact(
  target: ProviderReferenceTarget
): Promise<ProviderReferenceImpact> {
  const { inUse } = await inspectProviderReferences(target);
  return { inUse };
}

export async function reconcileDeletedProviderReference(
  target: ProviderReferenceTarget
): Promise<void> {
  const references = await inspectProviderReferences(target);
  const operations: Promise<unknown>[] = [];

  if (references.defaultModel) {
    operations.push(
      saveDefaultModelSettings({
        defaultProviderId: null,
        defaultModelId: null,
      })
    );
  }

  if (references.memory) {
    const memory = await loadMemorySettings();
    operations.push(
      saveMemorySettings({
        ...memory,
        memoryProviderId: null,
        memoryModelId: null,
      })
    );
  }

  const vision = await visionSettingsStore.load();
  const capabilityOverrides = vision.capabilityOverrides.filter(
    (override) =>
      !matchesTarget(target, override.providerId, override.modelId)
  );
  if (
    references.vision ||
    capabilityOverrides.length !== vision.capabilityOverrides.length
  ) {
    operations.push(
      visionSettingsStore.save({
        relay: references.vision ? { enabled: false } : vision.relay,
        capabilityOverrides,
      })
    );
  }

  await Promise.all(operations);
}
