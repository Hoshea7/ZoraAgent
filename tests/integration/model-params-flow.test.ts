import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProductivityProfile } from "@/main/agent-profiles/productivity-profile";
import type { AgentRequest, RunLimits } from "@/main/agent-profiles/types";
import type { ReasoningLevel } from "@/shared/zora";

function makeMockDependencies() {
  return {
    loadConversation: vi.fn(async () => []),
    buildDynamicContext: vi.fn(async () => "dynamic context"),
  };
}

describe("Model Params Harness Integration", () => {
  it("ProductivityProfile applies default limits when no overrides provided", async () => {
    const deps = makeMockDependencies();
    const profile = new ProductivityProfile(deps);

    const harness = await profile.prepare({
      sessionId: "test-session",
      workspaceId: "test-workspace",
      prompt: "hello",
      cwd: "/tmp/project",
      permissionMode: "default",
    });

    expect(harness.limits).toEqual({
      maxTurns: 500,
      maxOutputTokens: 16_384,
      reasoningLevel: "medium",
    });
  });

  it("ProductivityProfile applies reasoningLevel override from session", async () => {
    const deps = makeMockDependencies();
    const profile = new ProductivityProfile(deps);

    const harness = await profile.prepare({
      sessionId: "test-session",
      workspaceId: "test-workspace",
      prompt: "hello",
      cwd: "/tmp/project",
      permissionMode: "default",
      modelOverrides: { reasoningLevel: "high" },
    });

    expect(harness.limits.reasoningLevel).toBe("high");
    expect(harness.limits.maxTurns).toBe(500);
    expect(harness.limits.maxOutputTokens).toBe(16_384);
  });

  it("ProductivityProfile applies maxOutputTokens override", async () => {
    const deps = makeMockDependencies();
    const profile = new ProductivityProfile(deps);

    const harness = await profile.prepare({
      sessionId: "test-session",
      workspaceId: "test-workspace",
      prompt: "hello",
      cwd: "/tmp/project",
      permissionMode: "default",
      modelOverrides: { maxOutputTokens: 32_768 },
    });

    expect(harness.limits.maxOutputTokens).toBe(32_768);
  });

  it("ProductivityProfile applies all overrides together", async () => {
    const deps = makeMockDependencies();
    const profile = new ProductivityProfile(deps);

    const overrides: Partial<RunLimits> = {
      maxTurns: 50,
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

    expect(harness.limits).toEqual(overrides);
  });
});

describe("ReasoningLevel to Pi Model Translation", () => {
  it("reasoningLevel=off maps to thinkingLevel=undefined", async () => {
    vi.mock("@earendil-works/pi-coding-agent", () => ({
      ModelRuntime: {
        create: vi.fn(async () => ({
          registerProvider: vi.fn(),
          getModel: vi.fn(() => ({ id: "m", name: "m", api: "openai-completions", reasoning: true, input: ["text"] })),
        })),
      },
      SessionManager: { inMemory: vi.fn(() => ({})) },
      SettingsManager: { inMemory: vi.fn(() => ({})) },
      DefaultResourceLoader: vi.fn(function () { return { reload: vi.fn(async () => {}) }; }),
      createAgentSession: vi.fn(async () => ({ session: { subscribe: () => () => {}, prompt: vi.fn(), waitForIdle: vi.fn(), abort: vi.fn(), dispose: vi.fn(), setActiveToolsByName: vi.fn(), agent: { state: { messages: [], tools: [] } } } })),
      createCodingTools: vi.fn(() => []),
    }));
    vi.mock("@/main/runtime/pi-mcp-bridge", () => ({ createPiMcpTools: vi.fn(async () => []) }));

    const { PiSessionBridge } = await import("@/main/runtime/pi-session-bridge");
    const bridge = new PiSessionBridge();
    const config = {
      api: "openai-completions" as const,
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "test-model",
      providerId: "provider-1",
    };

    await bridge.getOrCreateAgent("session-1", config, "/tmp", {
      maxTurns: 500,
      maxOutputTokens: 16_384,
      reasoningLevel: "off",
    }, "system", [], "hello");

    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: undefined })
    );
  });

  it("reasoningLevel=max maps to thinkingLevel=high", async () => {
    vi.mock("@earendil-works/pi-coding-agent", () => ({
      ModelRuntime: {
        create: vi.fn(async () => ({
          registerProvider: vi.fn(),
          getModel: vi.fn(() => ({ id: "m", name: "m", api: "openai-completions", reasoning: true, input: ["text"] })),
        })),
      },
      SessionManager: { inMemory: vi.fn(() => ({})) },
      SettingsManager: { inMemory: vi.fn(() => ({})) },
      DefaultResourceLoader: vi.fn(function () { return { reload: vi.fn(async () => {}) }; }),
      createAgentSession: vi.fn(async () => ({ session: { subscribe: () => () => {}, prompt: vi.fn(), waitForIdle: vi.fn(), abort: vi.fn(), dispose: vi.fn(), setActiveToolsByName: vi.fn(), agent: { state: { messages: [], tools: [] } } } })),
      createCodingTools: vi.fn(() => []),
    }));
    vi.mock("@/main/runtime/pi-mcp-bridge", () => ({ createPiMcpTools: vi.fn(async () => []) }));

    const { PiSessionBridge } = await import("@/main/runtime/pi-session-bridge");
    const bridge = new PiSessionBridge();
    const config = {
      api: "openai-completions" as const,
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "test-model",
      providerId: "provider-1",
    };

    await bridge.getOrCreateAgent("session-2", config, "/tmp", {
      maxTurns: 500,
      maxOutputTokens: 16_384,
      reasoningLevel: "max",
    }, "system", [], "hello");

    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: "high" })
    );
  });
});

describe("ReasoningLevel to Claude SDK Translation", () => {
  it("maps every product level to official SDK options", async () => {
    const { toClaudeReasoningOptions } = await import("@/main/runtime/claude-model-config");
    expect(toClaudeReasoningOptions("off")).toEqual({ thinking: { type: "disabled" } });
    for (const level of ["low", "medium", "high"] as const) {
      expect(toClaudeReasoningOptions(level)).toEqual({
        thinking: { type: "adaptive" }, effort: level,
      });
    }
    expect(toClaudeReasoningOptions("max")).toEqual({
      thinking: { type: "adaptive" }, effort: "high",
    });
  });
});

describe("Full Flow: Session Runner to Harness", () => {
  it("reasoningLevel flows from RuntimeQueryInput through to harness.limits", async () => {
    const deps = makeMockDependencies();
    const profile = new ProductivityProfile(deps);

    // Simulate what AgentExecutionService.execute does
    const reasoningLevel: ReasoningLevel = "high";
    const harness = await profile.prepare({
      sessionId: "flow-test",
      workspaceId: "flow-workspace",
      prompt: "test prompt",
      cwd: "/tmp/flow",
      permissionMode: "default",
      modelOverrides: reasoningLevel
        ? { reasoningLevel }
        : undefined,
    });

    expect(harness.limits.reasoningLevel).toBe("high");
    expect(harness.limits.maxTurns).toBe(500);
    expect(harness.limits.maxOutputTokens).toBe(16_384);
  });

  it("undefined reasoningLevel uses default (medium)", async () => {
    const deps = makeMockDependencies();
    const profile = new ProductivityProfile(deps);

    const harness = await profile.prepare({
      sessionId: "flow-test",
      workspaceId: "flow-workspace",
      prompt: "test prompt",
      cwd: "/tmp/flow",
      permissionMode: "default",
      modelOverrides: undefined,
    });

    expect(harness.limits.reasoningLevel).toBe("medium");
  });
});
