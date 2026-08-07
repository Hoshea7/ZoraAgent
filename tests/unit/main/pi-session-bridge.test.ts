import { vi } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

// Mock pi-coding-agent module
const mockSession = {
  subscribe: vi.fn(() => () => {}),
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
  SessionManager: {
    inMemory: vi.fn(() => ({})),
  },
  SettingsManager: {
    inMemory: vi.fn(() => ({})),
  },
  loadSkills: vi.fn(() => ({
    skills: [
      {
        name: "zora-e2e-probe",
        description: "Project mantra: ZORA_SKILL_MANTRA_7788",
        filePath: "/tmp/.zora/skills/zora-e2e-probe/SKILL.md",
        baseDir: "/tmp/.zora/skills/zora-e2e-probe",
        disableModelInvocation: false,
      },
    ],
    diagnostics: [],
  })),
  DefaultResourceLoader: vi.fn(function () {
    return { reload: vi.fn(async () => {}) };
  }),
  createAgentSession: vi.fn(async () => ({ session: mockSession })),
  createCodingTools: vi.fn(() => [
    { name: "read", execute: vi.fn() },
    { name: "bash", execute: vi.fn() },
    { name: "edit", execute: vi.fn() },
    { name: "write", execute: vi.fn() },
  ]),
  createGrepTool: vi.fn(() => ({ name: "grep", execute: vi.fn() })),
  createFindTool: vi.fn(() => ({ name: "find", execute: vi.fn() })),
  createLsTool: vi.fn(() => ({ name: "ls", execute: vi.fn() })),
}));

vi.mock("@/main/runtime/pi-mcp-bridge", () => ({
  createPiMcpTools: vi.fn(async () => []),
}));

import { PiSessionBridge } from "@/main/runtime/pi-session-bridge";
import type { PiProviderConfig } from "@/main/runtime/pi-provider-registry";
import type { ModelTuning } from "@/main/agent-profiles";
import { createUnattendedToolGate } from "@/main/runtime/tool-gate";

/** 本文件只关心装配与生命周期；授权行为本身由 tool-gate / parity 测试覆盖。 */
const testToolGate = createUnattendedToolGate();

const provider: PiProviderConfig = {
  api: "openai-completions",
  baseUrl: "https://example.com/v1",
  apiKey: "sk-test",
  model: "example-model",
  providerId: "provider-1",
};

const modelTuning: ModelTuning = {
  maxOutputTokens: 16_384,
  reasoningLevel: "high",
};

describe("PiSessionBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.subscribe.mockReturnValue(() => {});
    mockSession.prompt.mockResolvedValue(undefined);
    mockSession.waitForIdle.mockResolvedValue(undefined);
    mockSession.abort.mockResolvedValue(undefined);
    mockSession.dispose.mockReset();
    mockSession.agent.state.messages = [];
    mockSession.agent.state.tools = [];
  });

  it("creates a session handle that can run prompts", async () => {
    const bridge = new PiSessionBridge();
    const handle = await bridge.getOrCreateAgent(
      "session-1",
      provider,
      "/tmp/project",
      modelTuning,
      "system prompt",
      [],
      "hello",
      [],
      testToolGate
    );

    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customTools: expect.arrayContaining([
          expect.objectContaining({ name: "read" }),
          expect.objectContaining({ name: "bash" }),
          expect.objectContaining({ name: "edit" }),
          expect.objectContaining({ name: "write" }),
          expect.objectContaining({ name: "grep" }),
          expect.objectContaining({ name: "find" }),
          expect.objectContaining({ name: "ls" }),
          expect.objectContaining({ name: "TodoWrite" }),
        ]),
      })
    );

    await handle.run("hello", "system", "context", () => {});

    expect(mockSession.prompt).toHaveBeenCalledWith("context\n\nhello", undefined);
    expect(mockSession.waitForIdle).toHaveBeenCalled();
  });

  it("loads Zora Skills through the SDK public resource APIs", async () => {
    const bridge = new PiSessionBridge();
    await bridge.getOrCreateAgent(
      "skills-session",
      provider,
      "/tmp/project",
      modelTuning,
      "system prompt",
      [],
      "hello",
      [],
      testToolGate
    );

    const { DefaultResourceLoader, loadSkills } = await import(
      "@earendil-works/pi-coding-agent"
    );
    expect(loadSkills).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      agentDir: expect.any(String),
      skillPaths: [expect.stringMatching(/[\\/]skills$/)],
      includeDefaults: false,
    });
    expect(DefaultResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        noExtensions: true,
        noSkills: true,
        skillsOverride: expect.any(Function),
      })
    );

    const loaderOptions = vi.mocked(DefaultResourceLoader).mock.calls[0]?.[0];
    const injected = loaderOptions?.skillsOverride?.({
      skills: [],
      diagnostics: [],
    });
    expect(injected?.skills).toEqual([
      expect.objectContaining({ name: "zora-e2e-probe" }),
    ]);
  });

  it("reuses the same session for the same session ID", async () => {
    const bridge = new PiSessionBridge();

    const handle1 = await bridge.getOrCreateAgent(
      "session-1",
      provider,
      "/tmp/project",
      modelTuning,
      "system",
      [],
      "hi",
      [],
      testToolGate
    );
    const handle2 = await bridge.getOrCreateAgent(
      "session-1",
      provider,
      "/tmp/project",
      modelTuning,
      "system",
      [],
      "hi",
      [],
      testToolGate
    );

    // Same underlying session, handles created from same session
    await handle1.run("test", "system", "", () => {});
    await handle2.run("test2", "system", "", () => {});

    // createAgentSession should only be called once
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    expect(createAgentSession).toHaveBeenCalledTimes(1);
  });

  it("disposes all sessions on disposeAll", async () => {
    const bridge = new PiSessionBridge();

    await bridge.getOrCreateAgent(
      "session-1",
      provider,
      "/tmp/project",
      modelTuning,
      "system",
      [],
      "hi",
      [],
      testToolGate
    );
    await bridge.getOrCreateAgent(
      "session-2",
      provider,
      "/tmp/project",
      modelTuning,
      "system",
      [],
      "hi",
      [],
      testToolGate
    );

    bridge.disposeAll();

    expect(mockSession.dispose).toHaveBeenCalledTimes(2);
  });

  it("aborts the session when handle.abort() is called", async () => {
    const bridge = new PiSessionBridge();
    const handle = await bridge.getOrCreateAgent(
      "session-1",
      provider,
      "/tmp/project",
      modelTuning,
      "system",
      [],
      "hi",
      [],
      testToolGate
    );

    handle.abort();

    expect(mockSession.abort).toHaveBeenCalled();
  });
});
