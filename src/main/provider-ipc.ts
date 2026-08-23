import type {
  ProviderModelDiscoveryInput,
  ProviderModelsTestInput,
  ProviderProtocol,
  ProviderType,
} from "../shared/types/provider";
import { PROVIDER_IPC } from "../shared/types/provider-ipc";
import {
  isProviderPresetId,
  PROVIDER_PRESETS,
} from "../shared/provider-presets";
import { parseProviderModels } from "./provider-config";
import { fetchProviderModels } from "./provider-model-discovery";
import { providerManager } from "./provider-manager";
import { getProviderReferenceImpact } from "./provider-reference-lifecycle";

type IpcMainLike = Pick<typeof import("electron").ipcMain, "handle">;

interface ProviderIpcDependencies {
  testModels: (
    input: ProviderModelsTestInput
  ) => ReturnType<typeof providerManager.testModels>;
  fetchModels: (
    input: ProviderModelDiscoveryInput
  ) => ReturnType<typeof fetchProviderModels>;
  cancelTest: (
    testRunId: string
  ) => ReturnType<typeof providerManager.cancelTestRun>;
  getReferenceImpact: typeof getProviderReferenceImpact;
}

const defaultDependencies: ProviderIpcDependencies = {
  testModels: (input) => providerManager.testModels(input),
  fetchModels: (input) => fetchProviderModels(input),
  cancelTest: (testRunId) => providerManager.cancelTestRun(testRunId),
  getReferenceImpact: (target) => getProviderReferenceImpact(target),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function parseProtocol(value: unknown): ProviderProtocol {
  if (value !== "anthropic-messages" && value !== "openai-completions") {
    throw new Error("protocol must be a supported provider protocol.");
  }
  return value;
}

function parseProviderType(value: unknown): ProviderType {
  const providerType = requiredString(value, "provider.providerType");
  if (
    !Object.values(PROVIDER_PRESETS).some(
      (preset) => preset.providerType === providerType
    )
  ) {
    throw new Error("providerType must be a supported provider type.");
  }
  return providerType as ProviderType;
}

export function registerProviderIpcHandlers(
  ipcMain: IpcMainLike,
  dependencies: ProviderIpcDependencies = defaultDependencies
): void {
  ipcMain.handle(
    PROVIDER_IPC.GET_REFERENCE_IMPACT,
    async (_event, providerId: unknown, modelId: unknown) => {
      const normalizedProviderId = requiredString(providerId, "providerId");
      if (modelId !== undefined && typeof modelId !== "string") {
        throw new Error("modelId must be a string when provided.");
      }
      const normalizedModelId = optionalString(modelId);
      return dependencies.getReferenceImpact({
        providerId: normalizedProviderId,
        modelIds: normalizedModelId ? [normalizedModelId] : undefined,
      });
    }
  );

  ipcMain.handle(PROVIDER_IPC.TEST_MODELS, async (_event, value: unknown) => {
    if (!isRecord(value)) throw new Error("A valid model test payload is required.");
    const presetId = requiredString(value.presetId, "provider.presetId");
    if (!isProviderPresetId(presetId)) {
      throw new Error("A valid presetId is required.");
    }
    const providerType = parseProviderType(value.providerType);
    const protocol = parseProtocol(value.protocol);
    const preset = PROVIDER_PRESETS[presetId];
    if (preset.providerType !== providerType) {
      throw new Error("Provider preset does not match providerType.");
    }
    if (preset.id !== "custom" && preset.protocol !== protocol) {
      throw new Error("Provider protocol does not match the selected preset.");
    }
    return dependencies.testModels({
      providerId: optionalString(value.providerId),
      providerName: optionalString(value.providerName),
      presetId,
      baseUrl: requiredString(value.baseUrl, "provider.baseUrl"),
      apiKey: requiredString(value.apiKey, "provider.apiKey"),
      models: parseProviderModels(value.models),
      testRunId: requiredString(value.testRunId, "provider.testRunId"),
      protocol,
      providerType,
    });
  });

  ipcMain.handle(PROVIDER_IPC.FETCH_MODELS, async (_event, value: unknown) => {
    if (!isRecord(value)) {
      throw new Error("A valid model discovery payload is required.");
    }
    const presetId = requiredString(value.presetId, "provider.presetId");
    if (!isProviderPresetId(presetId)) throw new Error("A valid presetId is required.");
    const providerType = parseProviderType(value.providerType);
    if (PROVIDER_PRESETS[presetId].providerType !== providerType) {
      throw new Error("Provider preset does not match providerType.");
    }
    return dependencies.fetchModels({
      presetId,
      providerType,
      protocol: parseProtocol(value.protocol),
      baseUrl: requiredString(value.baseUrl, "provider.baseUrl"),
      apiKey: requiredString(value.apiKey, "provider.apiKey"),
    });
  });

  ipcMain.handle(PROVIDER_IPC.CANCEL_TEST, (_event, testRunId: unknown) => {
    return dependencies.cancelTest(requiredString(testRunId, "testRunId"));
  });
}
