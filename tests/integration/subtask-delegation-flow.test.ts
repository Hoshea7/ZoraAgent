import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentStreamEvent } from "@/shared/zora";
import type { DelegationCoordinatorDependencies } from "@/main/delegation/coordinator";

const tempHomes = new Set<string>();

function createTempHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "zora-subtask-flow-"));
  tempHomes.add(home);
  return home;
}

async function loadFlow(home: string) {
  vi.resetModules();
  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return { ...actual, homedir: () => home };
  });

  const sessionStore = await import("@/main/session-store");
  const delegationModule = await import("@/main/delegation/coordinator");
  type TestDependencies = Omit<
    DelegationCoordinatorDependencies,
    "stop" | "getRunInfo"
  > &
    Partial<Pick<DelegationCoordinatorDependencies, "stop" | "getRunInfo">>;
  class TestDelegationCoordinator extends delegationModule.DelegationCoordinator {
    constructor(dependencies: TestDependencies) {
      const execute = dependencies.execute;
      super({
        stop: vi.fn(async () => "not_running"),
        getRunInfo: vi.fn(() => ({ running: false })),
        ...dependencies,
        execute: (input) => {
          input.onRunStarted?.();
          return execute(input);
        },
      });
    }
  }
  const delegation = {
    ...delegationModule,
    DelegationCoordinator: TestDelegationCoordinator,
    RawDelegationCoordinator: delegationModule.DelegationCoordinator,
  };
  return { sessionStore, delegation };
}

afterEach(() => {
  vi.doUnmock("node:os");
  vi.resetModules();
  for (const home of tempHomes) {
    rmSync(home, { recursive: true, force: true });
  }
  tempHomes.clear();
});

describe("subtask delegation user flow", () => {
  it("returns the terminal state when a delegated run fails before registration", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Failed child parent");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
    });
    const coordinator = new delegation.RawDelegationCoordinator({
      execute: async () => {
        throw new Error("runtime unavailable");
      },
      emit: vi.fn(),
      stop: vi.fn(),
      getRunInfo: vi.fn(() => ({ running: false })),
    });

    const result = await coordinator
      .forScope({ workspaceId: "default", parentSessionId: parent.id })
      .start(
        { task: "Inspect the project", role: "explore" },
        { invocationId: "pi:failed-before-start", runtime: "pi" }
      );

    expect(result).toMatchObject({
      status: "failed",
      error: "runtime unavailable",
    });
  });

  it("creates a visible child session and returns its completed result to the parent", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Review the project");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
      permissionMode: "smart",
    });

    const events: AgentStreamEvent[] = [];
    const coordinator = new delegation.DelegationCoordinator({
      execute: async () => ({
        status: "completed" as const,
        finalText: "The package name is zora.",
        runtimeSessionId: "runtime-child-1",
      }),
      emit: (event) => events.push(event),
    });
    const scoped = coordinator.forScope({
      workspaceId: "default",
      parentSessionId: parent.id,
    });

    const started = await scoped.start(
      {
        task: "Read package.json and report the package name.",
        role: "explore",
      },
      { invocationId: "pi:tool-call-1", runtime: "pi" }
    );
    const waited = await scoped.wait({
      delegationIds: [started.delegationId],
      mode: "all",
      timeoutSeconds: 2,
    });

    expect(waited).toMatchObject({
      status: "settled",
      settledCount: 1,
      runningCount: 0,
      subtasks: [
        {
          delegationId: started.delegationId,
          parentSessionId: parent.id,
          status: "completed",
          resultSummary: "The package name is zora.",
        },
      ],
    });

    const sessions = await sessionStore.listSessions("default");
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: started.delegationId,
          parentSessionId: parent.id,
          rootSessionId: parent.id,
          delegationRole: "explore",
          delegationStatus: "completed",
          delegationDepth: 1,
          permissionMode: "smart",
          workingDirectory: parent.workingDirectory,
          workingDirectoryOwnerSessionId: parent.id,
        }),
      ])
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "subtask_snapshot",
          reason: "created",
          sessionId: parent.id,
        }),
        expect.objectContaining({
          type: "subtask_snapshot",
          reason: "status_changed",
          sessionId: parent.id,
          subtask: expect.objectContaining({ status: "completed" }),
        }),
      ])
    );
  });

  it("keeps role and permission mode independent when creating a child session", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Permission parent");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
      permissionMode: "smart",
    });

    const coordinator = new delegation.DelegationCoordinator({
      execute: async () => ({ status: "completed" as const }),
      emit: vi.fn(),
    });
    const scoped = coordinator.forScope({
      workspaceId: "default",
      parentSessionId: parent.id,
    });

    const inherited = await scoped.start(
      {
        task: "Inspect the repository and use any required tools.",
        role: "explore",
      },
      { invocationId: "pi:permission-inherit", runtime: "pi" }
    );
    const restricted = await scoped.start(
      {
        task: "Review the repository with explicit approval for writes.",
        role: "review",
        permissionMode: "ask",
      },
      { invocationId: "pi:permission-restrict", runtime: "pi" }
    );
    const clamped = await scoped.start(
      {
        task: "Explore the repository without exceeding the parent authority.",
        role: "explore",
        permissionMode: "yolo",
      },
      { invocationId: "pi:permission-clamp", runtime: "pi" }
    );

    await expect(sessionStore.getSessionMeta(inherited.delegationId)).resolves.toMatchObject({
      delegationRole: "explore",
      permissionMode: "smart",
    });
    await expect(sessionStore.getSessionMeta(restricted.delegationId)).resolves.toMatchObject({
      delegationRole: "review",
      permissionMode: "ask",
    });
    await expect(sessionStore.getSessionMeta(clamped.delegationId)).resolves.toMatchObject({
      delegationRole: "explore",
      permissionMode: "smart",
    });
    await scoped.wait({
      delegationIds: [
        inherited.delegationId,
        restricted.delegationId,
        clamped.delegationId,
      ],
      mode: "all",
      timeoutSeconds: 2,
    });
  });

  it("runs children in parallel and surfaces a blocked child question to the parent", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Parallel review");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
    });

    const completions = new Map<string, (value: { status: "completed"; finalText: string }) => void>();
    const answered = vi.fn(() => "resolved" as const);
    const coordinator = new delegation.DelegationCoordinator({
      execute: ({ childSession }) =>
        new Promise((resolve) => completions.set(childSession.id, resolve)),
      emit: vi.fn(),
      answerQuestion: answered,
    });
    const scoped = coordinator.forScope({
      workspaceId: "default",
      parentSessionId: parent.id,
    });
    const batch = await scoped.startMany(
      {
        tasks: [
          { task: "Inspect package metadata", role: "explore", title: "Metadata" },
          { task: "Review scripts", role: "review", title: "Scripts" },
        ],
      },
      { invocationId: "pi:batch-1", runtime: "pi" }
    );
    expect(batch.created).toHaveLength(2);
    expect(completions.size).toBe(2);

    const blockedChild = batch.created[0];
    coordinator.observeChildEvent(blockedChild.delegationId, {
      type: "ask_user_request",
      sessionId: blockedChild.delegationId,
      request: {
        requestId: "ask-child-1",
        questions: [{ question: "Which package field?" }],
        toolInput: {},
      },
    });
    const waiting = await scoped.wait({
      delegationIds: batch.created.map((item) => item.delegationId),
      mode: "any",
      timeoutSeconds: 2,
    });
    expect(waiting).toMatchObject({
      status: "needs_input",
      delegationId: blockedChild.delegationId,
      blockedEvent: { id: "ask-child-1", type: "ask_user" },
      nextAction: "respond_to_delegation",
    });

    await expect(
      scoped.respond(blockedChild.delegationId, "ask-child-1", {
        type: "ask_user",
        answers: { "0": "name" },
      })
    ).resolves.toMatchObject({ status: "resolved" });
    expect(answered).toHaveBeenCalledWith("ask-child-1", { "0": "name" });

    for (const child of batch.created) {
      completions.get(child.delegationId)?.({
        status: "completed",
        finalText: child.title,
      });
    }
    await expect(
      scoped.wait({
        delegationIds: batch.created.map((item) => item.delegationId),
        mode: "all",
        timeoutSeconds: 2,
      })
    ).resolves.toMatchObject({ status: "settled", settledCount: 2 });
  });

  it("allows one parent to run ten delegated tasks concurrently", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Ten-way delegation");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
    });

    const coordinator = new delegation.DelegationCoordinator({
      execute: () => new Promise(() => undefined),
      emit: vi.fn(),
    });
    const scoped = coordinator.forScope({
      workspaceId: "default",
      parentSessionId: parent.id,
    });
    const batch = await scoped.startMany(
      {
        tasks: Array.from({ length: 10 }, (_, index) => ({
          task: `Inspect area ${index + 1}`,
          role: "explore" as const,
          title: `Area ${index + 1}`,
        })),
      },
      { invocationId: "pi:ten-way-batch", runtime: "pi" }
    );

    expect(batch.failures).toEqual([]);
    expect(batch.created).toHaveLength(10);
    await expect(
      scoped.start(
        { task: "Inspect one more area", role: "explore" },
        { invocationId: "pi:eleventh-child", runtime: "pi" }
      )
    ).rejects.toThrow("capacity limit");
  });

  it("keeps the parent wait suspended until the user resolves child permission", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Permission handoff");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
      permissionMode: "ask",
    });

    let complete!: (value: { status: "completed" }) => void;
    const respondPermission = vi.fn(() => "resolved" as const);
    const coordinator = new delegation.DelegationCoordinator({
      execute: () => new Promise((resolve) => {
        complete = resolve;
      }),
      emit: vi.fn(),
      respondPermission,
    });
    const scoped = coordinator.forScope({
      workspaceId: "default",
      parentSessionId: parent.id,
    });
    const child = await scoped.start(
      { task: "Run a controlled operation", role: "explore" },
      { invocationId: "pi:permission-handoff", runtime: "pi" }
    );
    coordinator.observeChildEvent(child.delegationId, {
      type: "permission_request",
      sessionId: child.delegationId,
      request: {
        requestId: "permission-child-1",
        toolName: "Bash",
        toolInput: { command: "node --version" },
        description: "执行命令: node --version",
      },
    });

    const abortController = new AbortController();
    let waitResolved = false;
    const abortedWait = scoped
      .wait(
        { delegationIds: [child.delegationId], timeoutSeconds: 1 },
        abortController.signal
      )
      .then((result) => {
        waitResolved = true;
        return result;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(waitResolved).toBe(false);
    abortController.abort(new Error("parent stopped"));
    await expect(abortedWait).rejects.toThrow("parent stopped");

    const waiting = scoped.wait({
      delegationIds: [child.delegationId],
      timeoutSeconds: 1,
    });

    await expect(
      scoped.respond(child.delegationId, "permission-child-1", {
        type: "permission",
        behavior: "allow",
      })
    ).resolves.toMatchObject({ status: "resolved" });
    expect(respondPermission).toHaveBeenCalledWith(
      "permission-child-1",
      "allow",
      false,
      undefined
    );
    complete({ status: "completed" });
    await expect(waiting).resolves.toMatchObject({
      status: "settled",
      settledCount: 1,
    });
  });

  it("selects a compatible runtime for another provider and continues the same child session", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Cross provider");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
    });
    const prompts: string[] = [];
    const userMessageIds: Array<string | undefined> = [];
    const coordinator = new delegation.DelegationCoordinator({
      execute: async ({ prompt, userMessageId }) => {
        prompts.push(prompt);
        userMessageIds.push(userMessageId);
        return { status: "completed", finalText: `result-${prompts.length}` };
      },
      emit: vi.fn(),
      resolveRuntimeTarget: async ({ providerId, selectedModelId }) => ({
        providerId,
        modelId: selectedModelId ?? "claude-model",
        runtime: "claude" as const,
      }),
    });
    const scoped = coordinator.forScope({
      workspaceId: "default",
      parentSessionId: parent.id,
    });
    const first = await scoped.start(
      {
        task: "Review the architecture",
        role: "review",
        providerId: "provider-2",
        modelId: "claude-model",
      },
      { invocationId: "pi:cross-1", runtime: "pi" }
    );
    await scoped.wait({ delegationIds: [first.delegationId], timeoutSeconds: 2 });
    const continued = await scoped.continueDelegation(
      first.delegationId,
      first.runId,
      "Now summarize the main risk.",
      {
        invocationId: "pi:continue-1",
        runtime: "pi",
        userMessageId: "renderer-user-1",
      }
    );
    expect(continued).toMatchObject({
      delegationId: first.delegationId,
      attempt: 2,
      status: "running",
      agentRuntimeType: "claude",
      providerId: "provider-2",
      modelId: "claude-model",
    });
    expect(continued.runId).not.toBe(first.runId);
    await expect(
      scoped.wait({ delegationIds: [first.delegationId], timeoutSeconds: 2 })
    ).resolves.toMatchObject({
      status: "settled",
      subtasks: [{ attempt: 2, resultSummary: "result-2" }],
    });
    expect(prompts[0]).toContain("## 子任务\nReview the architecture");
    expect(prompts[0]).toContain("审查已有内容");
    expect(prompts[1]).toBe("Now summarize the main risk.");
    expect(userMessageIds).toEqual([undefined, "renderer-user-1"]);
  });

  it("rejects explicit continue while an independent child run is active without changing delegation metadata", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Busy child parent");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
    });
    let childRunActive = false;
    const coordinator = new delegation.DelegationCoordinator({
      execute: async (input) => {
        input.onRunStarted?.();
        return { status: "completed", finalText: "ORIGINAL_RESULT" };
      },
      emit: vi.fn(),
      getRunInfo: () => ({ running: childRunActive, runId: "desktop-run" }),
    });
    const scoped = coordinator.forScope({
      workspaceId: "default",
      parentSessionId: parent.id,
    });
    const child = await scoped.start(
      { task: "Return the original result", role: "explore" },
      { invocationId: "pi:busy-child", runtime: "pi" }
    );
    await scoped.wait({ delegationIds: [child.delegationId], timeoutSeconds: 2 });
    const before = await sessionStore.getSessionMeta(child.delegationId);
    childRunActive = true;

    await expect(
      scoped.continueDelegation(
        child.delegationId,
        child.runId,
        "Continue delegated work",
        { invocationId: "pi:busy-continue", runtime: "pi" }
      )
    ).rejects.toThrow("child_session_busy");

    await expect(sessionStore.getSessionMeta(child.delegationId)).resolves.toMatchObject({
      delegationStatus: before?.delegationStatus,
      delegationRunId: before?.delegationRunId,
      delegationAttempt: before?.delegationAttempt,
      delegationRevision: before?.delegationRevision,
    });
  });

  it("builds a task-specific child prompt without forcing the default output format", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Prompt parent");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
    });
    const prompts: string[] = [];
    const coordinator = new delegation.DelegationCoordinator({
      execute: async ({ prompt }) => {
        prompts.push(prompt);
        return { status: "completed", finalText: "done" };
      },
      emit: vi.fn(),
    });
    const scoped = coordinator.forScope({
      workspaceId: "default",
      parentSessionId: parent.id,
    });

    const batch = await scoped.startMany(
      {
        sharedContext: "父任务正在比较两个实现。",
        tasks: [
          {
            task: "检查第一个实现。",
            role: "review",
            expectedOutput: "直接返回问题清单，不附加总结。",
          },
          {
            task: "检查第二个实现。",
            role: "explore",
          },
        ],
      },
      { invocationId: "pi:prompt-batch", runtime: "pi" }
    );
    await scoped.wait({
      delegationIds: batch.created.map((item) => item.delegationId),
      timeoutSeconds: 2,
    });

    const customPrompt = prompts.find((prompt) => prompt.includes("检查第一个实现。"));
    const defaultPrompt = prompts.find((prompt) => prompt.includes("检查第二个实现。"));
    expect(customPrompt).toContain("你是 Zora 协作子 Agent");
    expect(customPrompt).toContain("委派 ID 为");
    expect(customPrompt).toContain("如需修改文件，保持改动最小");
    expect(customPrompt).toContain(
      "## 子任务\n共享背景：\n父任务正在比较两个实现。\n\n子任务：\n检查第一个实现。"
    );
    expect(customPrompt).toContain("## 输出要求\n直接返回问题清单，不附加总结。");
    expect(customPrompt).not.toContain("关键发现、已执行操作");
    expect(defaultPrompt).toContain(
      "## 输出要求\n最终回复请包含：关键发现、已执行操作、验证结果、剩余风险或建议。"
    );
  });

  it("returns each child result summary up to fifty thousand characters without an aggregate budget", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Long result parent");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
    });
    const outputs = [
      `FIRST:${"A".repeat(29_994)}`,
      `SECOND:${"B".repeat(29_993)}`,
      `THIRD:${"C".repeat(50_004)}`,
    ];
    const coordinator = new delegation.DelegationCoordinator({
      execute: async ({ prompt }) => {
        const reportNumber = Number(prompt.match(/Return report (\d)/)?.[1]);
        return {
          status: "completed",
          finalText: outputs[reportNumber - 1],
        };
      },
      emit: vi.fn(),
    });
    const scoped = coordinator.forScope({
      workspaceId: "default",
      parentSessionId: parent.id,
    });
    const batch = await scoped.startMany(
      {
        tasks: outputs.map((_, index) => ({
          task: `Return report ${index + 1}`,
          role: "explore" as const,
        })),
      },
      { invocationId: "pi:long-results", runtime: "pi" }
    );
    await scoped.wait({
      delegationIds: batch.created.map((item) => item.delegationId),
      timeoutSeconds: 2,
    });

    const result = await scoped.getResults(
      batch.created.map((item) => item.delegationId)
    );
    expect(result.results[0]).toMatchObject({
      resultSummary: outputs[0],
      truncated: false,
    });
    expect(result.results[1]).toMatchObject({
      resultSummary: outputs[1],
      truncated: false,
    });
    expect(result.results[2].resultSummary).toBe(
      `${outputs[2].slice(0, 50_000)}\n\n[内容过长，已截断 10 字符，请打开子会话查看完整记录。]`
    );
    expect(result.results[2].truncated).toBe(true);
    expect(result).not.toHaveProperty("totalCharacters");
  });

  it("keeps the delegated result stable after an independent child conversation and restart", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Restarted result parent");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
    });
    const firstCoordinator = new delegation.DelegationCoordinator({
      execute: async () => ({
        status: "completed",
        finalText: "PERSISTED_RESULT_OK",
      }),
      emit: vi.fn(),
    });
    const firstScope = firstCoordinator.forScope({
      workspaceId: "default",
      parentSessionId: parent.id,
    });
    const child = await firstScope.start(
      { task: "Return a persistent result", role: "explore" },
      { invocationId: "pi:persisted-result", runtime: "pi" }
    );
    await firstScope.wait({ delegationIds: [child.delegationId], timeoutSeconds: 2 });
    await sessionStore.appendMessageRecord(
      child.delegationId,
      {
        kind: "assistant_turn",
        turn: {
          id: "persisted-result-turn",
          processSteps: [],
          bodySegments: [
            { id: "persisted-result-segment", text: "PERSISTED_RESULT_OK" },
          ],
          status: "done",
          startedAt: 1,
          completedAt: 2,
        },
      },
      "default"
    );
    await sessionStore.appendMessageRecord(
      child.delegationId,
      {
        kind: "user",
        message: {
          id: "desktop-follow-up-user",
          role: "user",
          text: "Continue as an ordinary conversation",
          timestamp: 3,
        },
      },
      "default"
    );
    await sessionStore.appendMessageRecord(
      child.delegationId,
      {
        kind: "assistant_turn",
        turn: {
          id: "desktop-follow-up-turn",
          processSteps: [],
          bodySegments: [
            { id: "desktop-follow-up-segment", text: "DESKTOP_RESULT_MUST_NOT_LEAK" },
          ],
          status: "done",
          startedAt: 4,
          completedAt: 5,
        },
      },
      "default"
    );

    const restartedCoordinator = new delegation.DelegationCoordinator({
      execute: vi.fn(),
      emit: vi.fn(),
    });
    const restartedScope = restartedCoordinator.forScope({
      workspaceId: "default",
      parentSessionId: parent.id,
    });
    await expect(
      restartedScope.wait({
        delegationIds: [child.delegationId],
        timeoutSeconds: 2,
      })
    ).resolves.toMatchObject({
      status: "settled",
      subtasks: [{ resultSummary: "PERSISTED_RESULT_OK" }],
    });
    await expect(
      restartedScope.getResults([child.delegationId])
    ).resolves.toMatchObject({
      results: [
        {
          runId: child.runId,
          resultSummary: "PERSISTED_RESULT_OK",
          truncated: false,
        },
      ],
    });
  });

  it("recovers interrupted runs and applies parent lifecycle changes to the child tree", async () => {
    const { sessionStore, delegation } = await loadFlow(createTempHome());
    const parent = await sessionStore.createSession("Lifecycle parent");
    await sessionStore.updateSessionMeta(parent.id, {
      providerId: "provider-1",
      providerLocked: true,
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
    });
    const child = await sessionStore.createDelegatedSession({
      id: "lifecycle-child",
      title: "Lifecycle child",
      workspaceId: "default",
      parentSessionId: parent.id,
      role: "explore",
      goal: "Inspect lifecycle",
      runId: "run-before-restart",
      attempt: 1,
      revision: 1,
      creationInvocation: { key: "create:lifecycle", inputHash: "hash" },
      providerId: "provider-1",
      selectedModelId: "model-1",
      agentRuntimeType: "pi",
    });

    await expect(sessionStore.archiveSession(parent.id)).rejects.toThrow(
      "存在运行中的子任务"
    );
    await expect(
      sessionStore.archiveSession(child.id, "default", "session")
    ).rejects.toThrow(
      "存在运行中的子任务"
    );

    await expect(sessionStore.recoverDelegationState()).resolves.toBe(1);
    await expect(sessionStore.getSessionMeta(child.id)).resolves.toMatchObject({
      delegationStatus: "interrupted",
      delegationRevision: 2,
      delegationError: "应用重启，原运行已中断",
    });
    const recoveredCoordinator = new delegation.DelegationCoordinator({
      execute: vi.fn(),
      emit: vi.fn(),
    });
    await expect(
      recoveredCoordinator
        .forScope({ workspaceId: "default", parentSessionId: parent.id })
        .getResults([child.id])
    ).resolves.toMatchObject({
      results: [
        {
          status: "interrupted",
          availability: "unavailable",
          errorCode: "result_unavailable",
        },
      ],
    });

    await sessionStore.archiveSession(child.id, "default", "session");
    await expect(sessionStore.listSessions("default")).resolves.toEqual([
      expect.objectContaining({ id: parent.id }),
    ]);
    await expect(
      sessionStore.listSessions("default", { archivedOnly: true })
    ).resolves.toEqual([
      expect.objectContaining({ id: child.id }),
    ]);
    await sessionStore.restoreSession(child.id);

    await sessionStore.archiveSession(child.id, "default", "family");
    expect(await sessionStore.listSessions("default", { archivedOnly: true })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: parent.id }),
        expect.objectContaining({ id: child.id }),
      ])
    );
    await sessionStore.restoreSession(child.id);
    await expect(sessionStore.listSessions("default")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: parent.id }),
        expect.objectContaining({ id: child.id }),
      ])
    );

    await sessionStore.archiveSession(parent.id);
    await sessionStore.restoreSession(parent.id);
    await sessionStore.deleteSession(parent.id);
    await expect(sessionStore.listSessions("default", { includeArchived: true })).resolves.toEqual([]);
  });
});
