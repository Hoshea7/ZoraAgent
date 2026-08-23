import type { ProviderReferenceImpact } from "../shared/types/provider";
import {
  loadDefaultModelSettings,
  saveDefaultModelSettings,
} from "./default-model-settings";
import { loadMemorySettings, saveMemorySettings } from "./memory-settings";
import { visionSettingsStore } from "./vision-settings";

export interface ProviderReferenceTarget {
  providerId: string;
  modelIds?: readonly string[];
}

interface ProviderReferenceState {
  memorySettings: Awaited<ReturnType<typeof loadMemorySettings>>;
  visionSettings: Awaited<ReturnType<typeof visionSettingsStore.load>>;
  references: ProviderReferenceImpact & {
    defaultModel: boolean;
    memory: boolean;
    vision: boolean;
  };
}

function matchesTarget(
  target: ProviderReferenceTarget,
  providerId: string | null | undefined,
  modelId: string | null | undefined
): boolean {
  if (providerId !== target.providerId) return false;
  if (target.modelIds !== undefined) {
    return modelId !== null && modelId !== undefined && target.modelIds.includes(modelId);
  }
  return true;
}

async function inspectProviderReferences(
  target: ProviderReferenceTarget
): Promise<ProviderReferenceState> {
  const [defaultModelSettings, memorySettings, visionSettings] = await Promise.all([
    loadDefaultModelSettings(),
    loadMemorySettings(),
    visionSettingsStore.load(),
  ]);
  const defaultModelInUse = matchesTarget(
    target,
    defaultModelSettings.defaultProviderId,
    defaultModelSettings.defaultModelId
  );
  const memoryInUse = matchesTarget(
    target,
    memorySettings.memoryProviderId,
    memorySettings.memoryModelId
  );
  const visionInUse = visionSettings.relay.enabled && matchesTarget(
    target,
    visionSettings.relay.providerId,
    visionSettings.relay.modelId
  );

  return {
    memorySettings,
    visionSettings,
    references: {
      inUse: defaultModelInUse || memoryInUse || visionInUse,
      defaultModel: defaultModelInUse,
      memory: memoryInUse,
      vision: visionInUse,
    },
  };
}

export async function getProviderReferenceImpact(
  target: ProviderReferenceTarget
): Promise<ProviderReferenceImpact> {
  const { references } = await inspectProviderReferences(target);
  return { inUse: references.inUse };
}

export async function reconcileDeletedProviderReference(
  target: ProviderReferenceTarget
): Promise<void> {
  const state = await inspectProviderReferences(target);
  const { references } = state;
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
    operations.push(
      saveMemorySettings({
        ...state.memorySettings,
        memoryProviderId: null,
        memoryModelId: null,
      })
    );
  }

  const capabilityOverrides = state.visionSettings.capabilityOverrides.filter(
    (override) =>
      !matchesTarget(target, override.providerId, override.modelId)
  );
  if (
    references.vision ||
    capabilityOverrides.length !== state.visionSettings.capabilityOverrides.length
  ) {
    operations.push(
      visionSettingsStore.save({
        relay: references.vision ? { enabled: false } : state.visionSettings.relay,
        capabilityOverrides,
      })
    );
  }

  await Promise.all(operations);
}
