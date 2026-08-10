import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentStreamEvent } from "@/shared/zora";

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
  const delegation = await import("@/main/delegation/coordinator");
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
          resultText: "The package name is zora.",
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
    const coordinator = new delegation.DelegationCoordinator({
      execute: async ({ prompt }) => {
        prompts.push(prompt);
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
      { invocationId: "pi:continue-1", runtime: "pi" }
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
      subtasks: [{ attempt: 2, resultText: "result-2" }],
    });
    expect(prompts[0]).toContain("## 子任务\nReview the architecture");
    expect(prompts[0]).toContain("审查已有内容");
    expect(prompts[1]).toBe("Now summarize the main risk.");
  });

  it("recovers interrupted runs and applies parent lifecycle changes to the child tree", async () => {
    const { sessionStore } = await loadFlow(createTempHome());
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
