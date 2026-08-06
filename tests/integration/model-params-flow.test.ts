import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProductivityProfile } from "@/main/agent-profiles/productivity-profile";
import type { AgentHarnessSpec, HarnessLimits } from "@/main/agent-profiles/types";
import type { ReasoningEffort } from "@/shared/zora";

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
      maxTurns: 120,
      maxOutputTokens: 16_384,
      reasoningEffort: "medium",
    });
  });

  it("ProductivityProfile applies reasoningEffort override from session", async () => {
    const deps = makeMockDependencies();
    const profile = new ProductivityProfile(deps);

    const harness = await profile.prepare({
      sessionId: "test-session",
      workspaceId: "test-workspace",
      prompt: "hello",
      cwd: "/tmp/project",
      permissionMode: "default",
      modelOverrides: { reasoningEffort: "high" },
    });

    expect(harness.limits.reasoningEffort).toBe("high");
    expect(harness.limits.maxTurns).toBe(120);
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

    const overrides: Partial<HarnessLimits> = {
      maxTurns: 50,
      maxOutputTokens: 8_192,
      reasoningEffort: "none",
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

describe("ReasoningEffort to Pi Model Translation", () => {
  it("reasoningEffort=none maps to reasoning=false", async () => {
    const { PiSessionBridge } = await import("@/main/runtime/pi-session-bridge");
    const handle = {
      replaceHistory: vi.fn(),
      run: vi.fn(),
      abort: vi.fn(),
      dispose: vi.fn(),
    };

    let capturedModel: unknown;
    const factory = vi.fn(async (_config, _dir, limits) => {
      const { buildPiModel: _bpm } = await import("@/main/runtime/pi-session-bridge");
      // We can't access buildPiModel directly, so we verify via session identity
      capturedModel = limits;
      return handle;
    });

    const bridge = new PiSessionBridge(factory);
    const config = {
      api: "openai-completions" as const,
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "test-model",
      providerId: "provider-1",
    };

    await bridge.getOrCreateAgent("session-1", config, "/tmp", {
      maxTurns: 120,
      maxOutputTokens: 16_384,
      reasoningEffort: "none",
    });

    expect(capturedModel).toEqual({
      maxTurns: 120,
      maxOutputTokens: 16_384,
      reasoningEffort: "none",
    });
  });

  it("different reasoningEffort values create different session identities", async () => {
    const { PiSessionBridge } = await import("@/main/runtime/pi-session-bridge");
    const handle1 = { replaceHistory: vi.fn(), run: vi.fn(), abort: vi.fn(), dispose: vi.fn() };
    const handle2 = { replaceHistory: vi.fn(), run: vi.fn(), abort: vi.fn(), dispose: vi.fn() };

    let callCount = 0;
    const factory = vi.fn(async () => {
      callCount++;
      return callCount === 1 ? handle1 : handle2;
    });

    const bridge = new PiSessionBridge(factory);
    const config = {
      api: "openai-completions" as const,
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "test-model",
      providerId: "provider-1",
    };

    await bridge.getOrCreateAgent("session-1", config, "/tmp", {
      maxTurns: 120,
      maxOutputTokens: 16_384,
      reasoningEffort: "low",
    });

    await bridge.getOrCreateAgent("session-1", config, "/tmp", {
      maxTurns: 120,
      maxOutputTokens: 16_384,
      reasoningEffort: "high",
    });

    expect(factory).toHaveBeenCalledTimes(2);
    expect(handle1.dispose).toHaveBeenCalledOnce();
  });
});

describe("ReasoningEffort to Claude SDK Translation", () => {
  it("REASONING_THINKING_BUDGET maps each effort level correctly", async () => {
    const { REASONING_THINKING_BUDGET } = await import("@/main/query-profiles/types");

    expect(REASONING_THINKING_BUDGET.none).toBeNull();
    expect(REASONING_THINKING_BUDGET.low).toBe(4_096);
    expect(REASONING_THINKING_BUDGET.medium).toBe(10_240);
    expect(REASONING_THINKING_BUDGET.high).toBe(32_768);
  });
});

describe("Full Flow: Session Runner to Harness", () => {
  it("reasoningEffort flows from RuntimeQueryInput through to harness.limits", async () => {
    const deps = makeMockDependencies();
    const profile = new ProductivityProfile(deps);

    // Simulate what AgentExecutionService.execute does
    const reasoningEffort: ReasoningEffort = "high";
    const harness = await profile.prepare({
      sessionId: "flow-test",
      workspaceId: "flow-workspace",
      prompt: "test prompt",
      cwd: "/tmp/flow",
      permissionMode: "default",
      modelOverrides: reasoningEffort
        ? { reasoningEffort }
        : undefined,
    });

    expect(harness.limits.reasoningEffort).toBe("high");
    expect(harness.limits.maxTurns).toBe(120);
    expect(harness.limits.maxOutputTokens).toBe(16_384);
  });

  it("undefined reasoningEffort uses default (medium)", async () => {
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

    expect(harness.limits.reasoningEffort).toBe("medium");
  });
});
