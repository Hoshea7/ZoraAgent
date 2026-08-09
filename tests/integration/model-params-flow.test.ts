import { describe, it, expect, vi } from "vitest";
import { ProductivityProfile } from "@/main/agent-profiles/productivity-profile";
import type { ModelTuning } from "@/main/agent-profiles/types";
import type { ReasoningLevel } from "@/shared/zora";
import { createUnattendedToolGate } from "@/main/runtime/tool-gate";

/** 本文件只关心模型参数翻译；授权行为由 tool-gate / parity 测试覆盖。 */
const testToolGate = createUnattendedToolGate();

function makeMockDependencies() {
  return {
    loadConversation: vi.fn(async () => []),
    buildDynamicContext: vi.fn(async () => "dynamic context"),
  };
}

const PI_SDK_MOCK = {
  ModelRuntime: {
    create: vi.fn(async () => ({
      registerProvider: vi.fn(),
      getModel: vi.fn(() => ({
        id: "m",
        name: "m",
        api: "openai-completions",
        reasoning: true,
        input: ["text"],
      })),
    })),
  },
  SessionManager: {
    create: vi.fn(() => ({ getEntries: () => [], appendMessage: vi.fn(), appendCustomEntry: vi.fn() })),
    open: vi.fn(() => ({ getEntries: () => [], appendMessage: vi.fn(), appendCustomEntry: vi.fn() })),
  },
  SettingsManager: { inMemory: vi.fn(() => ({})) },
  loadSkills: vi.fn(() => ({ skills: [], diagnostics: [] })),
  DefaultResourceLoader: vi.fn(function () {
    return { reload: vi.fn(async () => {}) };
  }),
  createAgentSession: vi.fn(async () => ({
    session: {
      subscribe: () => () => {},
      prompt: vi.fn(),
      waitForIdle: vi.fn(),
      abort: vi.fn(),
      dispose: vi.fn(),
      setActiveToolsByName: vi.fn(),
      sessionManager: { appendCustomEntry: vi.fn() },
      agent: { state: { messages: [], tools: [] } },
    },
  })),
  createCodingTools: vi.fn(() => []),
  createGrepTool: vi.fn(() => ({ name: "grep", execute: vi.fn() })),
  createFindTool: vi.fn(() => ({ name: "find", execute: vi.fn() })),
  createLsTool: vi.fn(() => ({ name: "ls", execute: vi.fn() })),
};

vi.mock("@earendil-works/pi-coding-agent", () => PI_SDK_MOCK);
vi.mock("@/main/runtime/pi-mcp-bridge", () => ({
  createPiMcpTools: vi.fn(async () => []),
  createPiToolsFromProvisioningPlan: vi.fn(() => []),
  disposePiMcpConnections: vi.fn(),
}));

const PI_PROVIDER_CONFIG = {
  api: "openai-completions" as const,
  baseUrl: "https://example.com/v1",
  apiKey: "sk-test",
  model: "test-model",
  providerId: "provider-1",
};

describe("Model Params Harness Integration", () => {
  it("ProductivityProfile applies default model tuning and budget", async () => {
    const profile = new ProductivityProfile(makeMockDependencies());

    const harness = await profile.prepare({
      sessionId: "test-session",
      workspaceId: "test-workspace",
      prompt: "hello",
      cwd: "/tmp/project",
      permissionMode: "default",
    });

    // 模型意图与运行治理分属两个结构：前者翻译给引擎，后者由 L2 执行。
    expect(harness.model).toEqual({
      maxOutputTokens: 16_384,
      reasoningLevel: "high",
    });
    expect(harness.budget).toEqual({ maxTurns: 500 });
  });

  it("ProductivityProfile applies reasoningLevel override from session", async () => {
    const profile = new ProductivityProfile(makeMockDependencies());

    const harness = await profile.prepare({
      sessionId: "test-session",
      workspaceId: "test-workspace",
      prompt: "hello",
      cwd: "/tmp/project",
      permissionMode: "default",
      modelOverrides: { reasoningLevel: "max" },
    });

    expect(harness.model.reasoningLevel).toBe("max");
    expect(harness.model.maxOutputTokens).toBe(16_384);
    expect(harness.budget.maxTurns).toBe(500);
  });

  it("ProductivityProfile applies maxOutputTokens override", async () => {
    const profile = new ProductivityProfile(makeMockDependencies());

    const harness = await profile.prepare({
      sessionId: "test-session",
      workspaceId: "test-workspace",
      prompt: "hello",
      cwd: "/tmp/project",
      permissionMode: "default",
      modelOverrides: { maxOutputTokens: 32_768 },
    });

    expect(harness.model.maxOutputTokens).toBe(32_768);
  });

  it("ProductivityProfile applies all model overrides together", async () => {
    const profile = new ProductivityProfile(makeMockDependencies());

    const overrides: ModelTuning = {
      maxOutputTokens: 8_192,
      reasoningLevel: "off",
    };

    const harness = await profile.prepare({
      sessionId: "test-session",
      workspaceId: "test-workspace",
      prompt: "hello",
      cwd: "/tmp/project",
      permissionMode: "default",
      modelOverrides: overrides,
    });

    expect(harness.model).toEqual(overrides);
    // 预算不属于模型参数，不应被 modelOverrides 影响。
    expect(harness.budget).toEqual({ maxTurns: 500 });
  });
});

describe("ReasoningLevel to Pi Model Translation", () => {
  const toolContext = (sessionId: string) => ({
    toolProvisioningPlan: { tools: [] },
    toolProvisioningRequest: {
      sessionId,
      workspaceId: "default",
      runtime: "pi" as const,
      source: "desktop" as const,
    },
    toolPolicy: { mode: "default" as const },
  });
  it("reasoningLevel=off maps to thinkingLevel=undefined", async () => {
    const { PiSessionBridge } = await import("@/main/runtime/pi-session-bridge");
    const bridge = new PiSessionBridge();

    await bridge.createTurn({
      sessionId: "session-off",
      workspaceId: "default",
      providerConfig: PI_PROVIDER_CONFIG,
      workingDirectory: "/tmp",
      modelTuning: { maxOutputTokens: 16_384, reasoningLevel: "off" },
      systemPrompt: "system",
      conversationMessages: [],
      currentPrompt: "hello",
      toolGate: testToolGate,
      ...toolContext("session-off"),
    });

    expect(PI_SDK_MOCK.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: undefined })
    );
  });

  it("reasoningLevel=max maps to thinkingLevel=max (no clamping)", async () => {
    const { PiSessionBridge } = await import("@/main/runtime/pi-session-bridge");
    const bridge = new PiSessionBridge();

    await bridge.createTurn({
      sessionId: "session-max",
      workspaceId: "default",
      providerConfig: PI_PROVIDER_CONFIG,
      workingDirectory: "/tmp",
      modelTuning: { maxOutputTokens: 16_384, reasoningLevel: "max" },
      systemPrompt: "system",
      conversationMessages: [],
      currentPrompt: "hello",
      toolGate: testToolGate,
      ...toolContext("session-max"),
    });

    expect(PI_SDK_MOCK.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: "max" })
    );
  });

  it("maxOutputTokens 作为模型 maxTokens 传给 Pi", async () => {
    const { PiSessionBridge } = await import("@/main/runtime/pi-session-bridge");
    const bridge = new PiSessionBridge();
    const registerProvider = vi.fn();
    PI_SDK_MOCK.ModelRuntime.create.mockResolvedValueOnce({
      registerProvider,
      getModel: vi.fn(() => ({
        id: "m",
        name: "m",
        api: "openai-completions",
        reasoning: true,
        input: ["text"],
      })),
    } as never);

    await bridge.createTurn({
      sessionId: "session-tokens",
      workspaceId: "default",
      providerConfig: PI_PROVIDER_CONFIG,
      workingDirectory: "/tmp",
      modelTuning: { maxOutputTokens: 4_096, reasoningLevel: "high" },
      systemPrompt: "system",
      conversationMessages: [],
      currentPrompt: "hello",
      toolGate: testToolGate,
      ...toolContext("session-tokens"),
    });

    expect(registerProvider).toHaveBeenCalledWith(
      "provider-1",
      expect.objectContaining({
        models: [expect.objectContaining({ maxTokens: 4_096 })],
      })
    );
  });
});

describe("ReasoningLevel to Claude SDK Translation", () => {
  it("maps every product level to official SDK options", async () => {
    const { toClaudeReasoningOptions } = await import(
      "@/main/runtime/claude-model-config"
    );
    expect(toClaudeReasoningOptions("off")).toEqual({
      thinking: { type: "disabled" },
    });
    expect(toClaudeReasoningOptions("high")).toEqual({
      thinking: { type: "adaptive" },
      effort: "high",
    });
    expect(toClaudeReasoningOptions("max")).toEqual({
      thinking: { type: "adaptive" },
      effort: "max",
    });
  });
});

describe("Full Flow: Session Runner to Harness", () => {
  it("reasoningLevel flows from RuntimeQueryInput through to harness.model", async () => {
    const profile = new ProductivityProfile(makeMockDependencies());

    const reasoningLevel: ReasoningLevel = "max";
    const harness = await profile.prepare({
      sessionId: "flow-test",
      workspaceId: "flow-workspace",
      prompt: "test prompt",
      cwd: "/tmp/flow",
      permissionMode: "default",
      modelOverrides: { reasoningLevel },
    });

    expect(harness.model.reasoningLevel).toBe("max");
    expect(harness.model.maxOutputTokens).toBe(16_384);
    expect(harness.budget.maxTurns).toBe(500);
  });

  it("undefined reasoningLevel uses default (high)", async () => {
    const profile = new ProductivityProfile(makeMockDependencies());

    const harness = await profile.prepare({
      sessionId: "flow-test",
      workspaceId: "flow-workspace",
      prompt: "test prompt",
      cwd: "/tmp/flow",
      permissionMode: "default",
      modelOverrides: undefined,
    });

    expect(harness.model.reasoningLevel).toBe("high");
  });
});
