import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentStreamEvent } from "@/shared/zora";

interface RevisionFlowControls {
  execute?: ReturnType<typeof vi.fn>;
  isRunning?: ReturnType<typeof vi.fn>;
}

describe("message revision flow", () => {
  const tempHomes = new Set<string>();

  afterEach(() => {
    vi.doUnmock("node:os");
    vi.resetModules();
    for (const home of tempHomes) {
      rmSync(home, { recursive: true, force: true });
    }
    tempHomes.clear();
  });

  async function loadRevisionFlow(controls: RevisionFlowControls = {}) {
    const home = mkdtempSync(path.join(tmpdir(), "zora-message-revision-"));
    tempHomes.add(home);
    const execute = controls.execute ?? vi.fn(async () => ({ status: "completed" as const }));
    const isRunning = controls.isRunning ?? vi.fn(() => false);
    const deleteSessionData = vi.fn();
    const scheduleProcessing = vi.fn();

    vi.resetModules();
    vi.doMock("node:os", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:os")>();
      return { ...actual, homedir: () => home };
    });
    vi.doMock("@/main/agent-execution-service", () => ({
      agentExecutionService: {
        execute,
        compact: vi.fn(),
        isRunning,
      },
    }));
    vi.doMock("@/main/runtime", () => ({
      agentRuntimeRouter: {
        deleteSessionData,
      },
    }));
    vi.doMock("@/main/runtime/runtime-execution-target", () => ({
      resolveAgentRuntimeTarget: vi.fn(async () => ({
        agentRuntimeType: "pi",
        provider: {
          id: "provider-1",
          name: "Provider",
          providerType: "custom",
          baseUrl: "https://example.com/v1",
          apiKey: "sk-test",
          contextWindow: 200_000,
        },
        protocol: "openai-compatible",
        modelId: "model-1",
        contextWindow: 200_000,
      })),
    }));
    vi.doMock("@/main/runtime/runtime-projection", () => ({
      createRuntimeProjectionFingerprint: vi.fn(() => ({
        runtime: "pi",
        providerId: "provider-1",
        modelId: "model-1",
        imageInputCapability: "supported",
        contextWindow: 200_000,
      })),
      hasRuntimeProjectionChanged: vi.fn(() => false),
    }));
    vi.doMock("@/main/memory-agent", () => ({
      memoryAgent: {
        scheduleProcessing,
      },
    }));
    vi.doMock("@/main/mcp-manager", () => ({
      getSharedMcpManager: vi.fn(() => ({
        getEditableConfig: vi.fn(async () => ({ servers: {} })),
      })),
    }));
    vi.doMock("@/main/delegation/subtask-tools", () => ({
      createSubtaskProvisionedTools: vi.fn(() => []),
    }));
    vi.doMock("@/main/delegation/service", () => ({
      delegationCoordinator: {
        forScope: vi.fn(() => ({})),
      },
    }));
    vi.doMock("@/main/hitl", () => ({
      setPermissionMode: vi.fn(),
    }));
    vi.doMock("@/main/vision-settings", () => ({
      visionSettingsStore: {
        load: vi.fn(async () => ({
          relay: { enabled: false },
          capabilityOverrides: [],
        })),
      },
    }));
    vi.doMock("@/main/model-capability-service", () => ({
      createRuntimeModelCapabilityResolver: vi.fn(async () => ({
        resolve: vi.fn(() => "supported"),
      })),
    }));

    const sessionStore = await import("@/main/session-store");
    const sessionRunner = await import("@/main/session-runner");
    return {
      deleteSessionData,
      execute,
      isRunning,
      scheduleProcessing,
      sessionRunner,
      sessionStore,
    };
  }

  async function createRunnableSession(
    sessionStore: Awaited<ReturnType<typeof loadRevisionFlow>>["sessionStore"],
    title: string
  ) {
    const session = await sessionStore.createSession(title);
    await sessionStore.updateSessionMeta(session.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
      sdkSessionId: "old-sdk-session",
      contextWindowState: {
        usedTokens: 10_000,
        contextWindow: 200_000,
        thresholdTokens: 160_000,
        status: "ready",
        compactionCount: 0,
        updatedAt: "2026-08-14T00:00:00.000Z",
      },
    });
    return session;
  }

  it("keeps the stable prefix, resets runtime state, and executes the revised prompt", async () => {
    const {
      deleteSessionData,
      execute,
      scheduleProcessing,
      sessionRunner,
      sessionStore,
    } = await loadRevisionFlow();
    const session = await createRunnableSession(sessionStore, "Revision flow");
    await sessionStore.appendMessageRecord(session.id, {
      kind: "user",
      message: {
        id: "user-prefix",
        role: "user",
        text: "Keep this prefix",
        timestamp: 1,
      },
    });
    await sessionStore.appendMessageRecord(session.id, {
      kind: "assistant_turn",
      turn: {
        id: "prefix-answer",
        processSteps: [],
        bodySegments: [{ id: "prefix-body", text: "Prefix kept" }],
        status: "done",
        startedAt: 2,
        completedAt: 2,
      },
    });
    await sessionStore.appendMessageRecord(session.id, {
      kind: "user",
      message: {
        id: "user-target",
        role: "user",
        text: "Old prompt",
        timestamp: 3,
      },
    });
    await sessionStore.appendMessageRecord(session.id, {
      kind: "assistant_turn",
      turn: {
        id: "old-answer",
        processSteps: [],
        bodySegments: [{ id: "old-body", text: "Old answer" }],
        status: "done",
        startedAt: 4,
        completedAt: 4,
      },
    });

    await sessionRunner.revisePromptInSession({
      sessionId: session.id,
      runId: "revision-run-1",
      workspaceId: "default",
      messageId: "user-target",
      text: "Revised prompt",
      forwardEvent: vi.fn(),
    });

    const revisedMessages = await sessionStore.loadMessages(session.id);
    expect(revisedMessages.map((message) => message.id)).toEqual([
      "user-prefix",
      "prefix-answer",
      "user-target",
    ]);
    expect(revisedMessages.at(-1)).toEqual(
      expect.objectContaining({
        id: "user-target",
        role: "user",
        text: "Revised prompt",
        timestamp: 3,
      })
    );
    const revisedSession = await sessionStore.getSessionMeta(session.id);
    expect(revisedSession).not.toHaveProperty("sdkSessionId");
    expect(revisedSession).not.toHaveProperty("contextWindowState");
    expect(deleteSessionData).toHaveBeenCalledWith(session.id, "default");
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        prompt: "Revised prompt",
        sessionId: session.id,
      })
    );
    expect(scheduleProcessing).toHaveBeenCalledWith(session.id, "default");
  });

  it("serializes concurrent revisions and rejects the second after the first run starts", async () => {
    let running = false;
    let finishRun: () => void = () => undefined;
    const runCompletion = new Promise<void>((resolve) => {
      finishRun = resolve;
    });
    const execute = vi.fn(async () => {
      running = true;
      await runCompletion;
      running = false;
      return { status: "completed" as const };
    });
    const isRunning = vi.fn(() => running);
    const { sessionRunner, sessionStore } = await loadRevisionFlow({ execute, isRunning });
    const session = await createRunnableSession(sessionStore, "Concurrent revision");
    await sessionStore.appendMessageRecord(session.id, {
      kind: "user",
      message: {
        id: "user-target",
        role: "user",
        text: "Original",
        timestamp: 1,
      },
    });

    const first = sessionRunner.revisePromptInSession({
      sessionId: session.id,
      runId: "revision-run-first",
      workspaceId: "default",
      messageId: "user-target",
      text: "First revision",
      forwardEvent: vi.fn(),
    });
    const second = sessionRunner.revisePromptInSession({
      sessionId: session.id,
      runId: "revision-run-second",
      workspaceId: "default",
      messageId: "user-target",
      text: "Second revision",
      forwardEvent: vi.fn(),
    });

    await expect(first).resolves.toMatchObject({ id: session.id });
    await expect(second).rejects.toThrow("当前会话正在运行");
    expect(await sessionStore.loadMessages(session.id)).toEqual([
      expect.objectContaining({ text: "First revision" }),
    ]);
    expect(execute).toHaveBeenCalledOnce();
    finishRun();
    await runCompletion;
  });

  it("forwards an execution startup failure to the renderer", async () => {
    const execute = vi.fn(async () => {
      throw new Error("runtime startup failed");
    });
    const { sessionRunner, sessionStore } = await loadRevisionFlow({ execute });
    const session = await createRunnableSession(sessionStore, "Failed revision run");
    await sessionStore.appendMessageRecord(session.id, {
      kind: "user",
      message: {
        id: "user-target",
        role: "user",
        text: "Original",
        timestamp: 1,
      },
    });
    const events: AgentStreamEvent[] = [];

    await sessionRunner.revisePromptInSession({
      sessionId: session.id,
      runId: "revision-run-failure",
      workspaceId: "default",
      messageId: "user-target",
      text: "Revised",
      forwardEvent: (event) => events.push(event),
    });
    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        type: "agent_error",
        error: "runtime startup failed",
        runId: "revision-run-failure",
      }));
    });
  });

  it("revises a delegated session without changing the parent transcript", async () => {
    const { sessionRunner, sessionStore } = await loadRevisionFlow();
    const parent = await createRunnableSession(sessionStore, "Parent");
    await sessionStore.appendMessageRecord(parent.id, {
      kind: "user",
      message: {
        id: "parent-user",
        role: "user",
        text: "Parent history",
        timestamp: 1,
      },
    });
    const child = await sessionStore.createDelegatedSession({
      id: "delegated-child",
      title: "Delegated child",
      workspaceId: "default",
      parentSessionId: parent.id,
      role: "explore",
      goal: "Inspect files",
      runId: "delegation-run",
      attempt: 1,
      revision: 1,
      creationInvocation: { key: "create:child", inputHash: "hash" },
      providerId: "provider-1",
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
    });
    await sessionStore.appendMessageRecord(child.id, {
      kind: "user",
      message: {
        id: "child-user",
        role: "user",
        text: "Old child prompt",
        timestamp: 2,
      },
    });

    await sessionRunner.revisePromptInSession({
      sessionId: child.id,
      runId: "child-revision-run",
      workspaceId: "default",
      messageId: "child-user",
      text: "Revised child prompt",
      forwardEvent: vi.fn(),
    });

    expect(await sessionStore.loadMessages(child.id)).toEqual([
      expect.objectContaining({ id: "child-user", text: "Revised child prompt" }),
    ]);
    expect(await sessionStore.loadMessages(parent.id)).toEqual([
      expect.objectContaining({ id: "parent-user", text: "Parent history" }),
    ]);
    expect(await sessionStore.getSessionMeta(child.id)).toMatchObject({
      parentSessionId: parent.id,
      delegationRunId: "delegation-run",
    });
  });
});
