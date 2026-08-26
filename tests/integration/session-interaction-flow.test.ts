import path from "node:path";

const moduleIds = {
  execution: path.resolve(process.cwd(), "src/main/agent-execution-service.ts"),
  memory: path.resolve(process.cwd(), "src/main/memory-agent.ts"),
  runner: path.resolve(process.cwd(), "src/main/session-runner.ts"),
  store: path.resolve(process.cwd(), "src/main/session-store.ts"),
};

interface InteractionControls {
  getRunInfo: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  runPrompt: ReturnType<typeof vi.fn>;
  appendMessage: ReturnType<typeof vi.fn>;
  revisePrompt: ReturnType<typeof vi.fn>;
  setRunInfo: (runInfo: {
    running: boolean;
    runId?: string;
    source?: "desktop" | "delegation";
  }) => void;
}

async function loadInteraction(initialRun: {
  running: boolean;
  runId?: string;
  source?: "desktop" | "delegation";
}) {
  vi.resetModules();
  let runInfo = initialRun;
  class TestAgentRunStateError extends Error {
    constructor(readonly code: "not_running" | "stopped" | "state_changed") {
      super(code);
    }
  }
  const controls: InteractionControls = {
    getRunInfo: vi.fn(() => runInfo),
    enqueue: vi.fn(async () => undefined),
    stop: vi.fn(async () => "stopped"),
    runPrompt: vi.fn(async (input: { runId: string }) => {
      runInfo = { running: true, runId: input.runId, source: "desktop" };
    }),
    appendMessage: vi.fn(async () => undefined),
    revisePrompt: vi.fn(async () => ({
      id: "session-1",
      title: "Session",
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    })),
    setRunInfo: (next) => {
      runInfo = next;
    },
  };
  vi.doMock(moduleIds.execution, () => ({
    AgentRunStateError: TestAgentRunStateError,
    agentExecutionService: {
      getRunInfo: controls.getRunInfo,
      enqueue: controls.enqueue,
      stop: controls.stop,
    },
  }));
  vi.doMock(moduleIds.memory, () => ({
    memoryAgent: { scheduleProcessing: vi.fn() },
  }));
  vi.doMock(moduleIds.runner, () => ({
    runPromptInSession: controls.runPrompt,
    revisePromptInSession: controls.revisePrompt,
  }));
  vi.doMock(moduleIds.store, () => ({
    appendMessageRecord: controls.appendMessage,
    loadMessages: vi.fn(async () => [
      {
        id: "target-user",
        role: "user",
        text: "Original requirement",
        timestamp: 1,
      },
    ]),
    saveAttachments: vi.fn(async () => []),
    projectSavedAttachments: vi.fn(async () => undefined),
  }));
  const { SessionInteraction } = await import("@/main/session-interaction");
  return {
    controls,
    interaction: new SessionInteraction({ forwardEvent: vi.fn() }),
  };
}

afterEach(() => {
  for (const moduleId of Object.values(moduleIds)) {
    vi.doUnmock(moduleId);
  }
  vi.resetModules();
});

describe("session interaction user flow", () => {
  it("starts an ordinary desktop run when a completed child session is idle", async () => {
    const { controls, interaction } = await loadInteraction({ running: false });

    const result = await interaction.submitUserMessage({
      sessionId: "completed-child",
      workspaceId: "workspace-1",
      messageId: "user-1",
      text: "Continue as an ordinary conversation",
    });

    expect(result).toMatchObject({ mode: "started", source: "desktop" });
    expect(controls.runPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "completed-child",
        workspaceId: "workspace-1",
        source: "desktop",
        userMessageId: "user-1",
      })
    );
  });

  it("enqueues user guidance into the exact active delegated run", async () => {
    const { controls, interaction } = await loadInteraction({
      running: true,
      runId: "delegated-run-1",
      source: "delegation",
    });

    await expect(
      interaction.submitUserMessage({
        sessionId: "active-child",
        workspaceId: "workspace-1",
        messageId: "user-guidance",
        text: "Use the updated requirement",
      })
    ).resolves.toEqual({
      mode: "enqueued",
      runId: "delegated-run-1",
      source: "delegation",
    });
    expect(controls.appendMessage).toHaveBeenCalledWith(
      "active-child",
      expect.objectContaining({
        kind: "user",
        message: expect.objectContaining({ id: "user-guidance" }),
      }),
      "workspace-1"
    );
    expect(controls.enqueue).toHaveBeenCalledWith(
      "active-child",
      "delegated-run-1",
      expect.objectContaining({ id: "user-guidance" })
    );
    expect(controls.runPrompt).not.toHaveBeenCalled();
  });

  it("persists structured annotations and enqueues their runtime projection", async () => {
    const { controls, interaction } = await loadInteraction({
      running: true,
      runId: "desktop-run-1",
      source: "desktop",
    });
    const responseAnnotations = [
      {
        id: "annotation-1",
        sourceMessageId: "assistant-1",
        anchor: {
          startOffset: 2,
          endOffset: 8,
          selectedText: "需要额外授权",
        },
        comment: "补充具体权限名称",
      },
    ];

    await interaction.submitUserMessage({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      messageId: "user-annotation",
      text: "",
      responseAnnotations,
    });

    expect(controls.appendMessage).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        kind: "user",
        message: expect.objectContaining({
          text: "请基于以下评论批注内容给出反馈。",
          responseAnnotations,
        }),
      }),
      "workspace-1"
    );
    expect(controls.enqueue).toHaveBeenCalledWith(
      "session-1",
      "desktop-run-1",
      expect.objectContaining({
        text: expect.stringContaining(
          "<comment>补充具体权限名称</comment>"
        ),
      })
    );
  });

  it("serializes two idle sends into one started run and one queued message", async () => {
    const { controls, interaction } = await loadInteraction({ running: false });

    const [first, second] = await Promise.all([
      interaction.submitUserMessage({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        messageId: "user-1",
        text: "First",
      }),
      interaction.submitUserMessage({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        messageId: "user-2",
        text: "Second",
      }),
    ]);

    expect(first.mode).toBe("started");
    expect(second).toMatchObject({ mode: "enqueued", runId: first.runId });
    expect(controls.runPrompt).toHaveBeenCalledOnce();
    expect(controls.enqueue).toHaveBeenCalledOnce();
  });

  it("does not stop a newer run when the renderer observed an older run", async () => {
    const { controls, interaction } = await loadInteraction({
      running: true,
      runId: "run-2",
      source: "desktop",
    });
    controls.stop.mockResolvedValueOnce("state_changed");

    await expect(
      interaction.stopCurrentRun("session-1", "run-1")
    ).resolves.toEqual({ mode: "state_changed", activeRunId: "run-2" });
    expect(controls.stop).toHaveBeenCalledWith("session-1", "run-1");
  });

  it("persists a correction only after the observed active run accepts it", async () => {
    const { controls, interaction } = await loadInteraction({
      running: true,
      runId: "delegated-run-1",
      source: "delegation",
    });

    await expect(
      interaction.submitUserEdit({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        targetMessageId: "target-user",
        text: "Corrected requirement",
        intent: "correct_active_run",
        observedRunId: "delegated-run-1",
      })
    ).resolves.toMatchObject({
      mode: "steered",
      runId: "delegated-run-1",
    });
    expect(controls.enqueue).toHaveBeenCalledWith(
      "session-1",
      "delegated-run-1",
      expect.objectContaining({
        text: expect.stringContaining("修正为：Corrected requirement"),
      })
    );
    expect(controls.appendMessage).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        kind: "user",
        message: expect.objectContaining({
          correction: { targetMessageId: "target-user" },
        }),
      }),
      "workspace-1"
    );
    expect(controls.enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      controls.appendMessage.mock.invocationCallOrder[0]
    );
    expect(controls.runPrompt).not.toHaveBeenCalled();
  });

  it("preserves completed history and starts a desktop run when the observed run ended", async () => {
    const { controls, interaction } = await loadInteraction({ running: false });

    const result = await interaction.submitUserEdit({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      targetMessageId: "target-user",
      text: "Corrected after completion",
      intent: "correct_active_run",
      observedRunId: "delegated-run-1",
    });

    expect(result).toMatchObject({ mode: "started_correction" });
    expect(controls.appendMessage).toHaveBeenCalledOnce();
    expect(controls.runPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "desktop",
        messageAlreadyPersisted: true,
        text: expect.stringContaining("Corrected after completion"),
      })
    );
    expect(controls.revisePrompt).not.toHaveBeenCalled();
  });

  it("returns state_changed without writing when another run replaced the observed run", async () => {
    const { controls, interaction } = await loadInteraction({
      running: true,
      runId: "run-2",
      source: "desktop",
    });

    await expect(
      interaction.submitUserEdit({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        targetMessageId: "target-user",
        text: "Do not apply",
        intent: "correct_active_run",
        observedRunId: "run-1",
      })
    ).resolves.toEqual({ mode: "state_changed", activeRunId: "run-2" });
    expect(controls.appendMessage).not.toHaveBeenCalled();
    expect(controls.enqueue).not.toHaveBeenCalled();
    expect(controls.runPrompt).not.toHaveBeenCalled();
  });

  it("revises durable history only when the session remains idle", async () => {
    const { controls, interaction } = await loadInteraction({ running: false });

    const result = await interaction.submitUserEdit({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      targetMessageId: "target-user",
      text: "Revised history",
      intent: "revise_history",
    });

    expect(result).toMatchObject({
      mode: "revised",
      session: { id: "session-1" },
      runId: expect.any(String),
    });
    expect(controls.revisePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        messageId: "target-user",
        text: "Revised history",
        runId: result.mode === "revised" ? result.runId : undefined,
      })
    );
    expect(controls.appendMessage).not.toHaveBeenCalled();
  });

  it("converts an enqueue completion race into a desktop correction run", async () => {
    const { controls, interaction } = await loadInteraction({
      running: true,
      runId: "run-1",
      source: "delegation",
    });
    const { AgentRunStateError } = await import("@/main/agent-execution-service");
    controls.enqueue.mockImplementationOnce(async () => {
      controls.setRunInfo({ running: false });
      throw new AgentRunStateError("not_running", "ended");
    });

    await expect(
      interaction.submitUserEdit({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        targetMessageId: "target-user",
        text: "Apply after race",
        intent: "correct_active_run",
        observedRunId: "run-1",
      })
    ).resolves.toMatchObject({ mode: "started_correction" });
    expect(controls.appendMessage).toHaveBeenCalledOnce();
    expect(controls.runPrompt).toHaveBeenCalledOnce();
  });
});
