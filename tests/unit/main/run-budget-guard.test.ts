import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

/**
 * RunBudget 是引擎无关的运行治理上限，由 L2 执行。
 *
 * 这个文件同时承担护栏职责：祖先 commit 里的 turn guard 曾被一次重构静默删除，
 * 且当时没有任何测试变红。这里既测纯逻辑，也测 Pi 侧确实消费了它。
 */

const subscribers: ((event: AgentSessionEvent) => void)[] = [];

const mockSession = {
  subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
    subscribers.push(listener);
    return () => {
      const index = subscribers.indexOf(listener);
      if (index >= 0) subscribers.splice(index, 1);
    };
  }),
  prompt: vi.fn(async () => {}),
  waitForIdle: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
  dispose: vi.fn(),
  setActiveToolsByName: vi.fn(),
  agent: { state: { messages: [], tools: [] } },
};

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: {
    create: vi.fn(async () => ({
      registerProvider: vi.fn(),
      getModel: vi.fn(() => ({
        id: "test-model",
        name: "test-model",
        api: "openai-completions",
        reasoning: true,
        input: ["text"],
      })),
    })),
  },
  SessionManager: { create: vi.fn(() => ({ getSessionId: () => "mock-sid", getSessionFile: () => "/tmp/m.jsonl" })), open: vi.fn(() => ({ getSessionId: () => "mock-sid", getSessionFile: () => "/tmp/m.jsonl" })) },
  SettingsManager: { inMemory: vi.fn(() => ({})) },
  loadSkills: vi.fn(() => ({ skills: [], diagnostics: [] })),
  DefaultResourceLoader: vi.fn(function () {
    return { reload: vi.fn(async () => {}) };
  }),
  createAgentSession: vi.fn(async () => ({ session: mockSession })),
  createCodingTools: vi.fn(() => [{ name: "read", execute: vi.fn() }]),
  createGrepTool: vi.fn(() => ({ name: "grep", execute: vi.fn() })),
  createFindTool: vi.fn(() => ({ name: "find", execute: vi.fn() })),
  createLsTool: vi.fn(() => ({ name: "ls", execute: vi.fn() })),
}));

vi.mock("@/main/runtime/pi-mcp-bridge", () => ({
  createPiMcpTools: vi.fn(async () => []),
}));

import { createRunBudgetGuard } from "@/main/runtime/run-budget-guard";
import { PiSessionBridge } from "@/main/runtime/pi-session-bridge";
import type { PiProviderConfig } from "@/main/runtime/pi-provider-registry";
import { createUnattendedToolGate } from "@/main/runtime/tool-gate";

/** 本文件只关心预算护栏；授权行为由 tool-gate / parity 测试覆盖。 */
const testToolGate = createUnattendedToolGate();

const provider: PiProviderConfig = {
  api: "openai-completions",
  baseUrl: "https://example.com/v1",
  apiKey: "sk-test",
  model: "test-model",
  providerId: "provider-1",
};

const modelTuning = { maxOutputTokens: 16_384, reasoningLevel: "high" } as const;

function emitTurnEnd(): void {
  for (const listener of [...subscribers]) {
    listener({ type: "turn_end" } as AgentSessionEvent);
  }
}

describe("createRunBudgetGuard", () => {
  it("在达到 maxTurns 时才要求停止", () => {
    const guard = createRunBudgetGuard({ maxTurns: 3 });

    expect(guard.shouldStopAfterTurn()).toBe(false);
    expect(guard.shouldStopAfterTurn()).toBe(false);
    expect(guard.shouldStopAfterTurn()).toBe(true);
  });

  it("maxTurns=1 时第一轮结束即停止", () => {
    const guard = createRunBudgetGuard({ maxTurns: 1 });
    expect(guard.shouldStopAfterTurn()).toBe(true);
  });

  it("reset 后重新开始计数", () => {
    const guard = createRunBudgetGuard({ maxTurns: 2 });
    guard.shouldStopAfterTurn();
    expect(guard.shouldStopAfterTurn()).toBe(true);

    guard.reset();
    expect(guard.shouldStopAfterTurn()).toBe(false);
  });

  it("非法 maxTurns 退化为至少 1 轮，而不是无限跑", () => {
    expect(createRunBudgetGuard({ maxTurns: 0 }).shouldStopAfterTurn()).toBe(true);
    expect(
      createRunBudgetGuard({ maxTurns: Number.NaN }).shouldStopAfterTurn()
    ).toBe(true);
  });
});

describe("Pi 侧确实消费 RunBudgetGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribers.length = 0;
    mockSession.prompt.mockImplementation(async () => {});
  });

  it("达到预算上限后主动中止当前运行", async () => {
    const bridge = new PiSessionBridge();
    const handle = await bridge.getOrCreateAgent(
      "budget-session",
      provider,
      "/tmp/project",
      modelTuning,
      "system",
      [],
      "hello",
      [],
      testToolGate
    );

    // 模型连跑两轮；预算只允许两轮，第二轮结束时应被中止。
    mockSession.prompt.mockImplementation(async () => {
      emitTurnEnd();
      emitTurnEnd();
    });

    await handle.run(
      "go",
      "system",
      "",
      () => {},
      "high",
      undefined,
      createRunBudgetGuard({ maxTurns: 2 })
    );

    expect(mockSession.abort).toHaveBeenCalledTimes(1);
  });

  it("未达上限时不中止", async () => {
    const bridge = new PiSessionBridge();
    const handle = await bridge.getOrCreateAgent(
      "budget-session-ok",
      provider,
      "/tmp/project",
      modelTuning,
      "system",
      [],
      "hello",
      [],
      testToolGate
    );

    mockSession.prompt.mockImplementation(async () => {
      emitTurnEnd();
    });

    await handle.run(
      "go",
      "system",
      "",
      () => {},
      "high",
      undefined,
      createRunBudgetGuard({ maxTurns: 5 })
    );

    expect(mockSession.abort).not.toHaveBeenCalled();
  });

  it("运行结束后解除预算订阅，不影响后续运行", async () => {
    const bridge = new PiSessionBridge();
    const handle = await bridge.getOrCreateAgent(
      "budget-session-cleanup",
      provider,
      "/tmp/project",
      modelTuning,
      "system",
      [],
      "hello",
      [],
      testToolGate
    );

    mockSession.prompt.mockImplementation(async () => {});
    await handle.run(
      "go",
      "system",
      "",
      () => {},
      "high",
      undefined,
      createRunBudgetGuard({ maxTurns: 1 })
    );

    // 上一轮的 guard 不应继续挂在 session 上，否则新一轮会被旧预算误伤。
    expect(subscribers).toHaveLength(0);
  });
});
