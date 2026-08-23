import { randomUUID } from "node:crypto";
import type {
  ProviderConfig,
  ProviderModelsTestInput,
  ProviderModelsTestResult,
  ProviderModelTestResult,
  ProviderTestResult,
} from "../shared/types/provider";
import type { AgentStreamEvent } from "../shared/zora";
import { ZORA_STATIC_SYSTEM_PROMPT } from "./prompts/zora-static-system-prompt";
import { PiAgentRuntimeAdapter } from "./runtime/pi-adapter";
import { resolveAgentRuntimeTargetFromProvider } from "./runtime/runtime-execution-target";
import type { AgentRuntimeHandle, AgentRuntimeInput } from "./runtime/types";
import type { ToolGate } from "./runtime/tool-gate";
import { getPackagedSafeWorkingDirectory } from "./sdk-runtime";
import { getErrorMessage, logSystemEvent, startSystemOperation } from "./system-log";

const TEST_CONNECTION_TIMEOUT_MS = 30_000;
const PROBE_WORKSPACE_ID = "provider-model-probe";

interface ProbeRun {
  cancelled: boolean;
  handles: Set<AgentRuntimeHandle>;
  completion: Promise<void>;
}

interface ProbeAdapter {
  start(input: AgentRuntimeInput): AgentRuntimeHandle;
  deleteSessionData(sessionId: string, workspaceId: string): void;
  dispose(): void;
}

type ProbeAdapterFactory = () => ProbeAdapter;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractAssistantText(event: AgentStreamEvent): string {
  if (event.type !== "assistant" || !isRecord(event.message)) return "";
  if (!Array.isArray(event.message.content)) return "";
  return event.message.content
    .flatMap((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : []
    )
    .join("")
    .trim();
}

function createProbeToolGate(): ToolGate {
  return {
    authorize: async () => ({
      behavior: "deny",
      message: "连接测试不会执行工具。",
    }),
    ask: async () => {
      throw new Error("连接测试不会向用户提问。");
    },
  };
}

function createDraftProvider(input: ProviderModelsTestInput): ProviderConfig {
  const now = Date.now();
  return {
    id: input.providerId?.trim() || `provider-probe-${input.testRunId}`,
    name: input.providerName?.trim() || "Provider 连接测试",
    providerType: input.providerType,
    baseUrl: input.baseUrl,
    apiKey: "",
    models: input.models.map((model) => ({ ...model })),
    presetId: input.presetId,
    protocol: input.protocol,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export class ProviderModelProbeRunner {
  private readonly runs = new Map<string, ProbeRun>();

  constructor(
    private readonly createAdapter: ProbeAdapterFactory = () =>
      new PiAgentRuntimeAdapter()
  ) {}

  async testModels(input: ProviderModelsTestInput): Promise<ProviderModelsTestResult> {
    const testRunId = input.testRunId.trim();
    const existing = this.runs.get(testRunId);
    if (existing) await this.cancel(testRunId);

    const run: ProbeRun = {
      cancelled: false,
      handles: new Set(),
      completion: Promise.resolve(),
    };
    this.runs.set(testRunId, run);

    const provider = createDraftProvider(input);
    const modelIds = input.models.map((model) => model.id);
    const resultsPromise = Promise.all(
      modelIds.map((modelId) => this.testModel(run, provider, input.apiKey, modelId))
    );
    run.completion = resultsPromise.then(() => undefined, () => undefined);

    try {
      const results = await resultsPromise;
      return {
        success: results.every((result) => result.success),
        results,
      };
    } finally {
      if (this.runs.get(testRunId) === run) this.runs.delete(testRunId);
    }
  }

  async cancel(testRunId: string): Promise<boolean> {
    const run = this.runs.get(testRunId.trim());
    if (!run) return false;

    run.cancelled = true;
    await Promise.allSettled([...run.handles].map((handle) => handle.abort()));
    await run.completion;
    return true;
  }

  private async testModel(
    run: ProbeRun,
    provider: ProviderConfig,
    apiKey: string,
    modelId: string
  ): Promise<ProviderModelTestResult> {
    const operation = startSystemOperation("provider", "pi-probe", {
      providerId: provider.id,
      modelId,
      protocol: provider.protocol,
    });
    if (run.cancelled) {
      return { modelId, success: false, message: "测试已停止" };
    }

    const adapter = this.createAdapter();
    const sessionId = `provider-probe-${randomUUID()}`;
    const expectedReply = `ZORA_PI_PROBE_${randomUUID().replaceAll("-", "").toUpperCase()}`;
    let assistantText = "";
    let runtimeError: string | null = null;
    let handle: AgentRuntimeHandle | null = null;
    let timedOut = false;

    try {
      const target = await resolveAgentRuntimeTargetFromProvider({
        agentRuntimeType: "pi",
        provider,
        apiKey,
        selectedModelId: modelId,
      });
      if (run.cancelled) {
        return { modelId, success: false, message: "测试已停止" };
      }

      const prompt = [
        "This is a Provider connectivity check through the production Pi Runtime.",
        "Do not call tools or ask questions.",
        `Reply with exactly this text and nothing else: ${expectedReply}`,
      ].join("\n");
      const input: AgentRuntimeInput = {
        harness: {
          profileId: "productivity",
          sessionId,
          workspaceId: PROBE_WORKSPACE_ID,
          prompt: {
            user: prompt,
            dynamicContext: "runtime_mode=provider_connectivity_probe",
            system: ZORA_STATIC_SYSTEM_PROMPT,
          },
          conversation: { messages: [], persistence: "ephemeral" },
          workspace: { cwd: getPackagedSafeWorkingDirectory() },
          permissions: { mode: "interactive" },
          model: {
            maxOutputTokens: Math.min(target.maxTokens ?? 16_384, 16_384),
            reasoningLevel: "high",
          },
          budget: { maxTurns: 1 },
          output: { incremental: true, visible: false },
        },
        target,
        toolGate: createProbeToolGate(),
        source: "desktop",
        forwardEvent: (event) => {
          const text = extractAssistantText(event);
          if (text) assistantText = text;
          if (event.type === "agent_error") runtimeError = event.error;
        },
        toolProvisioningPlan: { tools: [] },
        vision: {
          imageInputCapability: "unknown",
          visionRelayEnabled: false,
        },
      };

      handle = adapter.start(input);
      run.handles.add(handle);
      const timeoutId = setTimeout(() => {
        timedOut = true;
        void handle?.abort();
      }, TEST_CONNECTION_TIMEOUT_MS);
      const result = await handle.completion.finally(() => clearTimeout(timeoutId));

      if (timedOut) {
        operation.end("failure", "Pi 模型连接测试超时", undefined, { level: "warn" });
        return {
          modelId,
          success: false,
          message: "连接超时，请检查网络或 Provider 配置。",
        };
      }
      if (run.cancelled || result.status === "stopped") {
        operation.end("stopped", "Pi 模型连接测试已停止");
        return { modelId, success: false, message: "测试已停止" };
      }
      if (runtimeError) throw new Error(runtimeError);
      if (assistantText.trim() !== expectedReply) {
        throw new Error("模型已响应，但未返回预期的测试结果。请重试。");
      }

      operation.end("success", "Pi 模型连接测试成功");
      return { modelId, success: true, message: "连接成功" };
    } catch (error) {
      if (run.cancelled) {
        operation.end("stopped", "Pi 模型连接测试已停止");
        return { modelId, success: false, message: "测试已停止" };
      }
      const message = timedOut
        ? "连接超时，请检查网络或 Provider 配置。"
        : getErrorMessage(error);
      operation.end("failure", "Pi 模型连接测试失败", { message }, { level: "warn" });
      return { modelId, success: false, message };
    } finally {
      if (handle) run.handles.delete(handle);
      try {
        adapter.deleteSessionData(sessionId, PROBE_WORKSPACE_ID);
      } catch (error) {
        logSystemEvent(
          "provider",
          "pi-probe",
          "cleanup-failure",
          "清理 Pi 模型测试会话失败",
          {
            providerId: provider.id,
            modelId,
            sessionId,
            error: getErrorMessage(error),
          },
          { level: "warn" }
        );
      }
      try {
        adapter.dispose();
      } catch (error) {
        logSystemEvent(
          "provider",
          "pi-probe",
          "dispose-failure",
          "释放 Pi 模型测试 Runtime 失败",
          {
            providerId: provider.id,
            modelId,
            sessionId,
            error: getErrorMessage(error),
          },
          { level: "warn" }
        );
      }
      logSystemEvent("provider", "pi-probe", "cleanup", "清理 Pi 模型测试会话", {
        providerId: provider.id,
        modelId,
        sessionId,
      });
    }
  }
}

export const providerModelProbeRunner = new ProviderModelProbeRunner();

export function toSingleProviderTestResult(
  result: ProviderModelsTestResult
): ProviderTestResult {
  return result.results[0] ?? { success: false, message: "没有可测试的模型。" };
}
