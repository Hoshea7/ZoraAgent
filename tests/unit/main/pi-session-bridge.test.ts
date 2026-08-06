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
  DefaultResourceLoader: vi.fn(function () {
    return { reload: vi.fn(async () => {}) };
  }),
  createAgentSession: vi.fn(async () => ({ session: mockSession })),
  createCodingTools: vi.fn(() => []),
}));

vi.mock("@/main/runtime/pi-mcp-bridge", () => ({
  createPiMcpTools: vi.fn(async () => []),
}));

import { PiSessionBridge } from "@/main/runtime/pi-session-bridge";
import type { PiProviderConfig } from "@/main/runtime/pi-provider-registry";
import type { RunLimits } from "@/main/agent-profiles";

const provider: PiProviderConfig = {
  api: "openai-completions",
  baseUrl: "https://example.com/v1",
  apiKey: "sk-test",
  model: "example-model",
  providerId: "provider-1",
};

const limits: RunLimits = {
  maxTurns: 120,
  maxOutputTokens: 16_384,
  reasoningLevel: "medium",
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
      limits,
      "system prompt",
      [],
      "hello"
    );

    await handle.run("hello", "system", "context", () => {});

    expect(mockSession.prompt).toHaveBeenCalledWith("context\n\nhello", undefined);
    expect(mockSession.waitForIdle).toHaveBeenCalled();
  });

  it("reuses the same session for the same session ID", async () => {
    const bridge = new PiSessionBridge();

    const handle1 = await bridge.getOrCreateAgent(
      "session-1",
      provider,
      "/tmp/project",
      limits,
      "system",
      [],
      "hi"
    );
    const handle2 = await bridge.getOrCreateAgent(
      "session-1",
      provider,
      "/tmp/project",
      limits,
      "system",
      [],
      "hi"
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
      limits,
      "system",
      [],
      "hi"
    );
    await bridge.getOrCreateAgent(
      "session-2",
      provider,
      "/tmp/project",
      limits,
      "system",
      [],
      "hi"
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
      limits,
      "system",
      [],
      "hi"
    );

    handle.abort();

    expect(mockSession.abort).toHaveBeenCalled();
  });
});
