import { vi } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Mock pi-coding-agent module
const mockSession = {
  subscribe: vi.fn(() => () => {}),
  prompt: vi.fn(async () => {}),
  waitForIdle: vi.fn(async () => {}),
  steer: vi.fn(async () => {}),
  followUp: vi.fn(async () => {}),
  compact: vi.fn(async () => {}),
  clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
  abortCompaction: vi.fn(),
  abort: vi.fn(async () => {}),
  dispose: vi.fn(),
  setActiveToolsByName: vi.fn(),
  sessionManager: {
    appendCustomEntry: vi.fn(),
  },
  agent: {
    state: { messages: [], tools: [] },
    beforeToolCall: undefined as
      | ((context: unknown, signal?: AbortSignal) => Promise<unknown>)
      | undefined,
  },
};

const mockSessionManager = {
  getSessionId: vi.fn(() => "mock-session-id"),
  getSessionFile: vi.fn(() => "/tmp/mock.jsonl"),
  getEntries: vi.fn(() => []),
  appendMessage: vi.fn(),
  appendCustomEntry: vi.fn(),
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
        contextWindow: 200_000,
      })),
    })),
  },
  SessionManager: {
    create: vi.fn(() => mockSessionManager),
    open: vi.fn(() => mockSessionManager),
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
  createPiToolsFromProvisioningPlan: vi.fn(() => []),
  disposePiMcpConnections: vi.fn(),
}));

import { PiSessionBridge } from "@/main/runtime/pi-session-bridge";
import type { PiProviderConfig } from "@/main/runtime/pi-provider-registry";
import type { ModelTuning } from "@/main/agent-profiles";
import { createUnattendedToolGate } from "@/main/runtime/tool-gate";
import type { ImageInputCapability } from "@/shared/types/vision";

/** 本文件只关心装配与生命周期；授权行为本身由 tool-gate / parity 测试覆盖。 */
const testToolGate = createUnattendedToolGate();

const provider: PiProviderConfig = {
  api: "openai-completions",
  baseUrl: "https://example.com/v1",
  apiKey: "sk-test",
  model: "example-model",
  providerId: "provider-1",
  supportsDeveloperRole: false,
  contextWindow: 200_000,
};

const modelTuning: ModelTuning = {
  maxOutputTokens: 16_384,
  reasoningLevel: "high",
};

let sessionEventListeners: Array<(event: AgentSessionEvent) => void> = [];

function emitSessionEvent(event: AgentSessionEvent) {
  for (const listener of sessionEventListeners) {
    listener(event);
  }
}

function createTurn(
  bridge: PiSessionBridge,
  overrides: Partial<Parameters<PiSessionBridge["createTurn"]>[0]> = {}
) {
  return bridge.createTurn({
    sessionId: "session-1",
    workspaceId: "default",
    providerConfig: provider,
    workingDirectory: "/tmp/project",
    modelTuning,
    systemPrompt: "system",
    dynamicContext: "",
    conversationMessages: [],
    currentPrompt: "hello",
    extraTools: [],
    toolGate: testToolGate,
    toolProvisioningPlan: { tools: [] },
    toolProvisioningRequest: {
      sessionId: "session-1",
      workspaceId: "default",
      runtime: "pi",
      source: "desktop",
    },
    ...overrides,
  });
}

async function registeredModelInput(capability: ImageInputCapability) {
  const mod = await import("@earendil-works/pi-coding-agent");
  const registerProvider = vi.fn();
  vi.mocked(mod.ModelRuntime.create).mockResolvedValueOnce({
    registerProvider,
    getModel: vi.fn(() => ({
      id: "test-model",
      name: "test-model",
      api: "openai-completions",
      reasoning: true,
      input: ["text"],
      contextWindow: 200_000,
    })),
  } as never);
  const bridge = new PiSessionBridge(mkdtempSync(path.join(tmpdir(), "zora-pi-capability-")));
  const handle = await createTurn(bridge, { imageInputCapability: capability });
  handle.dispose();
  return registerProvider.mock.calls[0]?.[1]?.models?.[0]?.input;
}

async function registeredModelCompat() {
  const mod = await import("@earendil-works/pi-coding-agent");
  const registerProvider = vi.fn();
  vi.mocked(mod.ModelRuntime.create).mockResolvedValueOnce({
    registerProvider,
    getModel: vi.fn(() => ({
      id: "test-model",
      name: "test-model",
      api: "openai-completions",
      reasoning: true,
      input: ["text"],
      contextWindow: 200_000,
    })),
  } as never);
  const bridge = new PiSessionBridge(mkdtempSync(path.join(tmpdir(), "zora-pi-compat-")));
  const handle = await createTurn(bridge);
  handle.dispose();
  return registerProvider.mock.calls[0]?.[1]?.models?.[0]?.compat;
}

describe("PiSessionBridge", () => {
  let sessionRoot: string;

  beforeEach(() => {
    sessionRoot = mkdtempSync(path.join(tmpdir(), "zora-pi-session-"));
    vi.clearAllMocks();
    sessionEventListeners = [];
    mockSession.subscribe.mockImplementation((listener) => {
      sessionEventListeners.push(listener as (event: AgentSessionEvent) => void);
      return () => {
        sessionEventListeners = sessionEventListeners.filter(
          (candidate) => candidate !== listener
        );
      };
    });
    mockSession.prompt.mockResolvedValue(undefined);
    mockSession.waitForIdle.mockResolvedValue(undefined);
    mockSession.steer.mockResolvedValue(undefined);
    mockSession.followUp.mockResolvedValue(undefined);
    mockSession.compact.mockResolvedValue(undefined);
    mockSession.clearQueue.mockReturnValue({ steering: [], followUp: [] });
    mockSession.abortCompaction.mockReset();
    mockSession.abort.mockResolvedValue(undefined);
    mockSession.dispose.mockReset();
    mockSession.agent.state.messages = [];
    mockSession.agent.state.tools = [];
    mockSession.agent.beforeToolCall = undefined;
    mockSessionManager.getEntries.mockReturnValue([]);
    mockSessionManager.appendMessage.mockReset();
    mockSessionManager.appendCustomEntry.mockReset();
  });

  it.each([
    ["supported", ["text", "image"]],
    ["unsupported", ["text"]],
    ["unknown", ["text"]],
  ] as const)("registers %s models with the correct input declaration", async (capability, expected) => {
    await expect(registeredModelInput(capability)).resolves.toEqual(expected);
  });

  it("registers OpenAI-compatible models with system-role compatibility", async () => {
    await expect(registeredModelCompat()).resolves.toEqual({
      allowEmptySignature: true,
      supportsDeveloperRole: false,
    });
  });

  afterEach(() => {
    rmSync(sessionRoot, { recursive: true, force: true });
  });

  it("creates a session handle that can run prompts", async () => {
    const bridge = new PiSessionBridge(sessionRoot);
    const handle = await createTurn(bridge, {
      systemPrompt: "system prompt",
      dynamicContext: "dynamic memory",
    });

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

    expect(mockSession.prompt).toHaveBeenCalledWith("hello", undefined);
    expect(mockSession.waitForIdle).not.toHaveBeenCalled();

    const { DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");
    const loaderOptions = vi.mocked(DefaultResourceLoader).mock.calls[0]?.[0];
    const handlers: Array<(event: { systemPrompt: string }) => unknown> = [];
    const extension = loaderOptions?.extensionFactories?.[0];
    const factory = typeof extension === "function" ? extension : extension?.factory;
    await factory?.({
      on: (event: string, handler: (event: { systemPrompt: string }) => unknown) => {
        if (event === "before_agent_start") handlers.push(handler);
      },
    } as never);
    expect(handlers).toHaveLength(1);
    expect(await handlers[0]?.({ systemPrompt: "system prompt\n\nskills\n\ncwd" })).toEqual({
      systemPrompt: "system prompt\n\nskills\n\ncwd\n\ndynamic memory",
    });
  });

  it("uses the native Pi compaction API and forwards its events", async () => {
    const bridge = new PiSessionBridge(sessionRoot);
    const handle = await createTurn(bridge);
    const onEvent = vi.fn();

    mockSession.compact.mockImplementationOnce(async () => {
      emitSessionEvent({ type: "compaction_start", reason: "manual" });
    });

    await handle.compact(onEvent);

    expect(mockSession.compact).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({
      type: "compaction_start",
      reason: "manual",
    });
  });

  it("keeps native Pi compaction and continuation inside the same user run", async () => {
    mockSession.prompt.mockImplementation(async () => {
      emitSessionEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "analysis consumed the remaining tokens" },
            { type: "text", text: "" },
          ],
          stopReason: "length",
        },
      } as AgentSessionEvent);
      emitSessionEvent({ type: "compaction_start", reason: "threshold" });
      emitSessionEvent({
        type: "compaction_end",
        reason: "overflow",
        result: undefined,
        aborted: false,
        willRetry: true,
      });
      emitSessionEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "completed after compaction" }],
          stopReason: "stop",
        },
      } as AgentSessionEvent);
      emitSessionEvent({ type: "agent_settled" });
    });

    const bridge = new PiSessionBridge(sessionRoot);
    const handle = await createTurn(bridge, { currentPrompt: "finish the task" });
    const events: AgentSessionEvent[] = [];

    await handle.run("finish the task", "system", "", (event) => events.push(event));

    expect(mockSession.prompt).toHaveBeenCalledOnce();
    expect(mockSession.followUp).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === "agent_settled")).toHaveLength(1);
    expect(
      events.some(
        (event) =>
          event.type === "message_end" &&
          event.message.role === "assistant" &&
          event.message.stopReason === "stop"
      )
    ).toBe(true);
  });

  it("configures Pi to compact at 80% of the registered model context regardless of output budget", async () => {
    const bridge = new PiSessionBridge(sessionRoot);

    await createTurn(bridge, {
      modelTuning: { ...modelTuning, maxOutputTokens: 128_000 },
    });

    const { SettingsManager } = await import("@earendil-works/pi-coding-agent");
    expect(SettingsManager.inMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        compaction: {
          enabled: true,
          reserveTokens: 40_000,
        },
      })
    );
  });

  it("passes the detected Git Bash path to Pi settings and coding tools", async () => {
    const shellPath = "D:\\Git\\Git\\bin\\bash.exe";
    vi.stubEnv("CLAUDE_CODE_GIT_BASH_PATH", shellPath);
    try {
      const bridge = new PiSessionBridge(sessionRoot);

      await createTurn(bridge);

      const { SettingsManager, createCodingTools } = await import(
        "@earendil-works/pi-coding-agent"
      );
      expect(SettingsManager.inMemory).toHaveBeenCalledWith(
        expect.objectContaining({ shellPath })
      );
      expect(createCodingTools).toHaveBeenCalledWith("/tmp/project", {
        bash: { shellPath },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("loads Zora Skills through the SDK public resource APIs", async () => {
    const bridge = new PiSessionBridge(sessionRoot);
    await createTurn(bridge, {
      sessionId: "skills-session",
      systemPrompt: "system prompt",
    });

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

  it("creates a fresh AgentSession for every turn", async () => {
    const bridge = new PiSessionBridge(sessionRoot);
    const handle1 = await createTurn(bridge, { currentPrompt: "hi" });
    const handle2 = await createTurn(bridge, { currentPrompt: "hi" });

    await handle1.run("test", "system", "", () => {});
    await handle2.run("test2", "system", "", () => {});

    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    expect(createAgentSession).toHaveBeenCalledTimes(2);
  });

  it("reopens the same Pi checkpoint after the app creates a new bridge", async () => {
    const checkpointDir = path.join(sessionRoot, "workspace-1", "session-1");
    const checkpointFile = path.join(checkpointDir, "2026-08-09_session-1.jsonl");
    mkdirSync(checkpointDir, { recursive: true });
    writeFileSync(checkpointFile, "checkpoint");
    mockSessionManager.getEntries.mockReturnValue([
      {
        type: "custom",
        id: "cursor-entry",
        parentId: null,
        timestamp: "2026-08-09T00:00:00.000Z",
        customType: "zora.turn-cursor",
        data: { userMessageId: "previous-user" },
      },
    ]);

    const bridgeAfterRestart = new PiSessionBridge(sessionRoot);
    await createTurn(bridgeAfterRestart, {
      workspaceId: "workspace-1",
      conversationMessages: [
        { id: "previous-user", role: "user", text: "previous", timestamp: 1 },
        {
          id: "previous-assistant",
          role: "assistant",
          timestamp: 2,
          turn: {
            id: "previous-turn",
            processSteps: [],
            bodySegments: [{ id: "previous-body", text: "answer" }],
            status: "done",
            startedAt: 2,
          },
        },
        { id: "current-user", role: "user", text: "hello", timestamp: 3 },
      ],
    });

    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    expect(SessionManager.open).toHaveBeenCalledWith(
      checkpointFile,
      checkpointDir,
      "/tmp/project"
    );
    expect(mockSessionManager.appendMessage).not.toHaveBeenCalled();
  });

  it("applies the model and reasoning selected for each new turn", async () => {
    const bridge = new PiSessionBridge(sessionRoot);

    await createTurn(bridge, { currentPrompt: "hi" });
    await createTurn(bridge, {
      providerConfig: { ...provider, model: "next-model" },
      modelTuning: { ...modelTuning, reasoningLevel: "max" },
      currentPrompt: "next",
    });

    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    expect(createAgentSession).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createAgentSession).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ thinkingLevel: "max" })
    );
  });

  it("imports only turns produced by another Runtime after the last Pi turn", async () => {
    mockSessionManager.getEntries.mockReturnValue([
      {
        type: "custom",
        id: "cursor-entry",
        parentId: null,
        timestamp: "2026-08-09T00:00:00.000Z",
        customType: "zora.turn-cursor",
        data: { userMessageId: "pi-user" },
      },
    ]);
    const bridge = new PiSessionBridge(sessionRoot);

    await createTurn(bridge, {
      currentPrompt: "back to pi",
      conversationMessages: [
        { id: "pi-user", role: "user", text: "pi question", timestamp: 1 },
        {
          id: "pi-assistant",
          role: "assistant",
          timestamp: 2,
          turn: {
            id: "pi-turn",
            processSteps: [],
            bodySegments: [{ id: "pi-body", text: "pi answer" }],
            status: "done",
            startedAt: 2,
          },
        },
        { id: "claude-user", role: "user", text: "claude question", timestamp: 3 },
        {
          id: "claude-assistant",
          role: "assistant",
          timestamp: 4,
          turn: {
            id: "claude-turn",
            processSteps: [],
            bodySegments: [{ id: "claude-body", text: "claude answer" }],
            status: "done",
            startedAt: 4,
          },
        },
        { id: "current-user", role: "user", text: "back to pi", timestamp: 5 },
      ],
    });

    expect(mockSessionManager.appendMessage).toHaveBeenCalledTimes(2);
    expect(mockSessionManager.appendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: "user", content: "claude question" })
    );
    expect(mockSessionManager.appendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: "assistant" })
    );
  });

  it("records the current Zora user message as the Pi turn cursor before prompting", async () => {
    const bridge = new PiSessionBridge(sessionRoot);
    const handle = await createTurn(bridge, {
      conversationMessages: [
        { id: "current-user", role: "user", text: "hello", timestamp: 1 },
      ],
    });

    await handle.run("hello", "system", "", () => {});

    expect(mockSession.sessionManager.appendCustomEntry).toHaveBeenCalledWith(
      "zora.turn-cursor",
      { userMessageId: "current-user" }
    );
  });

  it("disposes all sessions on disposeAll", async () => {
    const bridge = new PiSessionBridge(sessionRoot);

    await createTurn(bridge, { sessionId: "session-1", currentPrompt: "hi" });
    await createTurn(bridge, { sessionId: "session-2", currentPrompt: "hi" });

    bridge.disposeAll();

    expect(mockSession.dispose).toHaveBeenCalledTimes(1);
  });

  it("deletes the derived checkpoint for a removed product session", () => {
    const checkpointDirectory = path.join(sessionRoot, "workspace-1", "session-1");
    mkdirSync(checkpointDirectory, { recursive: true });
    writeFileSync(path.join(checkpointDirectory, "session.jsonl"), "checkpoint");
    const bridge = new PiSessionBridge(sessionRoot);

    bridge.deleteCheckpoint("session-1", "workspace-1");

    expect(() => rmSync(checkpointDirectory)).toThrow();
  });

  it("clears accepted guidance before aborting the session", async () => {
    const bridge = new PiSessionBridge(sessionRoot);
    const handle = await createTurn(bridge, { currentPrompt: "hi" });

    await handle.abort();

    expect(mockSession.clearQueue).toHaveBeenCalledOnce();
    expect(mockSession.abort).toHaveBeenCalledOnce();
    expect(mockSession.clearQueue.mock.invocationCallOrder[0]).toBeLessThan(
      mockSession.abort.mock.invocationCallOrder[0]!
    );
  });

  it("cancels an in-progress compaction before aborting the session", async () => {
    mockSession.abort.mockImplementation(async () => {
      expect(mockSession.abortCompaction).toHaveBeenCalledOnce();
    });

    const bridge = new PiSessionBridge(sessionRoot);
    const handle = await createTurn(bridge, { currentPrompt: "hi" });

    await handle.abort();

    expect(mockSession.abortCompaction).toHaveBeenCalledOnce();
  });

  it("skips a tool before execution when guidance arrived during thinking", async () => {
    const bridge = new PiSessionBridge(sessionRoot);
    const handle = await createTurn(bridge, { currentPrompt: "hi" });

    await handle.steer("改为处理新任务");
    const result = await mockSession.agent.beforeToolCall?.(
      {
        toolCall: { id: "tool-1", name: "Agent", arguments: {} },
        args: {},
      },
      new AbortController().signal
    );

    expect(mockSession.steer).toHaveBeenCalledWith("改为处理新任务", undefined);
    expect(result).toEqual({
      block: true,
      reason: "用户发送了新的引导消息，当前工具调用已跳过。",
    });
  });
});
