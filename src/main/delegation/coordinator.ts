import { createHash, randomUUID } from "node:crypto";
import type {
  AgentRuntimeType,
  AgentStreamEvent,
  DelegateArgs,
  DelegateManyArgs,
  DelegateManyResult,
  DelegationResults,
  DelegationScope,
  PermissionMode,
  SessionMeta,
  SubtaskStatus,
  SubtaskBlockedEvent,
  SubtaskBlockedResponse,
  SubtaskRespondResult,
  SubtaskSummary,
  WaitArgs,
  WaitResult,
} from "../../shared/zora";
import {
  createDelegatedSession,
  getSessionMeta,
  listSessions,
  updateSessionMeta,
} from "../session-store";
import {
  buildDelegationPrompt,
  buildDelegationTaskWithSharedContext,
} from "./prompt";
import {
  EMPTY_COMPLETED_RESULT,
  truncateResultSummary,
} from "./result-summary";
import { getResult, putTerminalResult } from "./result-store";
import { runSessionCommand } from "../session-command-gate";

export type DelegationExecutionResult =
  | { status: "completed"; finalText?: string; runtimeSessionId?: string }
  | {
      status: "failed";
      error: string;
      finalText?: string;
      runtimeSessionId?: string;
    }
  | { status: "stopped"; finalText?: string; runtimeSessionId?: string };

export interface DelegationExecutionInput {
  workspaceId: string;
  parentSessionId: string;
  childSession: SessionMeta;
  prompt: string;
  runtime: AgentRuntimeType;
  signal: AbortSignal;
  userMessageId?: string;
  onRunStarted?: (runId: string) => void;
}

export interface DelegationInvocationContext {
  invocationId: string;
  runtime: AgentRuntimeType;
  providerId?: string;
  modelId?: string;
  userMessageId?: string;
}

export interface DelegationCoordinatorDependencies {
  execute: (input: DelegationExecutionInput) => Promise<DelegationExecutionResult>;
  emit: (event: AgentStreamEvent) => void;
  stop?: (sessionId: string, expectedRunId: string) => Promise<unknown>;
  getRunInfo?: (sessionId: string) => { running: boolean; runId?: string };
  respondPermission?: (
    requestId: string,
    behavior: "allow" | "deny",
    alwaysAllow: boolean,
    userMessage?: string
  ) => "resolved" | "not_found";
  answerQuestion?: (
    requestId: string,
    answers: Record<string, string>
  ) => "resolved" | "not_found";
  resolveRuntimeTarget?: (input: {
    providerId: string;
    selectedModelId?: string;
    preferredRuntime: AgentRuntimeType;
  }) => Promise<{
    providerId: string;
    modelId: string;
    runtime: AgentRuntimeType;
  }>;
}

interface LiveDelegation {
  scope: DelegationScope;
  meta: SessionMeta;
  resultSummary?: string;
  resultTruncated?: boolean;
  resultPersisted?: boolean;
  interrupted?: boolean;
  started: Promise<void>;
  resolveStarted: () => void;
  abortController: AbortController;
  completion: Promise<void>;
  userMessageId?: string;
  pendingInteractions: Map<string, SubtaskBlockedEvent>;
  resolvedInteractionHashes: Map<string, string>;
}

const TERMINAL_STATUSES = new Set<SubtaskStatus>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export const DEFAULT_DELEGATION_WAIT_TIMEOUT_SECONDS = 300;
export const MAX_DELEGATION_WAIT_TIMEOUT_SECONDS = 600;
const PERMISSION_MODE_RANK: Record<PermissionMode, number> = {
  ask: 0,
  smart: 1,
  yolo: 2,
};

function resolveDelegatedPermissionMode(
  parentMode: PermissionMode,
  requestedMode?: PermissionMode
): PermissionMode {
  if (!requestedMode) return parentMode;
  return PERMISSION_MODE_RANK[requestedMode] <= PERMISSION_MODE_RANK[parentMode]
    ? requestedMode
    : parentMode;
}

function hashInvocation(args: DelegateArgs): string {
  const normalized = {
    agentRuntimeType: args.agentRuntimeType,
    expectedOutput: args.expectedOutput?.trim(),
    modelId: args.modelId?.trim(),
    providerId: args.providerId?.trim(),
    permissionMode: args.permissionMode,
    role: args.role,
    task: args.task.trim(),
    title: args.title?.trim(),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function titleFrom(args: DelegateArgs): string {
  return (args.title?.trim() || args.task.trim().split("\n", 1)[0]).slice(0, 80);
}

function requireRuntimeFields(meta: SessionMeta): asserts meta is SessionMeta & {
  providerId: string;
  agentRuntimeType: AgentRuntimeType;
} {
  if (!meta.providerId || !meta.agentRuntimeType) {
    throw new Error("The parent session does not have a complete runtime target.");
  }
}

export class DelegationCoordinator {
  private readonly live = new Map<string, LiveDelegation>();
  private readonly listeners = new Set<() => void>();
  private changeRevision = 0;

  constructor(private readonly dependencies: DelegationCoordinatorDependencies) {}

  forScope(scope: DelegationScope): ScopedDelegationCoordinator {
    return new ScopedDelegationCoordinator(this, scope);
  }

  async start(
    scope: DelegationScope,
    args: DelegateArgs,
    invocation: DelegationInvocationContext
  ): Promise<SubtaskSummary> {
    const task = args.task.trim();
    if (!task || task.length > 20_000) {
      throw new Error("task must contain between 1 and 20,000 characters.");
    }
    const parent = await getSessionMeta(scope.parentSessionId, scope.workspaceId);
    if (!parent || parent.archivedAt || parent.parentSessionId) {
      throw new Error(`Parent session ${scope.parentSessionId} is unavailable.`);
    }
    requireRuntimeFields(parent);
    const selectedProviderId = args.providerId?.trim() || parent.providerId;
    const preferredRuntime = args.agentRuntimeType ?? invocation.runtime;
    const resolvedTarget = this.dependencies.resolveRuntimeTarget
      ? await this.dependencies.resolveRuntimeTarget({
          providerId: selectedProviderId,
          selectedModelId: args.modelId?.trim() || invocation.modelId || parent.selectedModelId,
          preferredRuntime,
        })
      : {
          providerId: selectedProviderId,
          modelId: args.modelId?.trim() || invocation.modelId || parent.selectedModelId,
          runtime: preferredRuntime,
        };
    const selectedModelId = resolvedTarget.modelId;
    if (!selectedModelId) {
      throw new Error("The parent session does not have a resolved model target.");
    }

    const allSessions = await listSessions(scope.workspaceId, { includeArchived: true });
    const runningForParent = allSessions.filter(
      (session) =>
        session.parentSessionId === scope.parentSessionId &&
        session.delegationStatus === "running"
    ).length;
    const runningGlobal = allSessions.filter(
      (session) => session.parentSessionId && session.delegationStatus === "running"
    ).length;
    if (runningForParent >= 10 || runningGlobal >= 20) {
      throw new Error("The delegation capacity limit has been reached.");
    }

    const invocationKey = `${scope.workspaceId}:${scope.parentSessionId}:delegate_agent:${invocation.invocationId}`;
    const inputHash = hashInvocation(args);
    const existing = allSessions.find(
      (session) =>
        session.parentSessionId === scope.parentSessionId &&
        session.delegationCreationInvocation?.key === invocationKey
    );
    if (existing) {
      if (existing.delegationCreationInvocation?.inputHash !== inputHash) {
        throw new Error("The delegation invocation was reused with different input.");
      }
      return this.toSummaryWithPersistedResult(existing, scope.workspaceId);
    }

    const delegationId = randomUUID();
    const runId = randomUUID();
    const permissionMode = resolveDelegatedPermissionMode(
      parent.permissionMode ?? "ask",
      args.permissionMode
    );
    const child = await createDelegatedSession({
      id: delegationId,
      title: titleFrom(args),
      workspaceId: scope.workspaceId,
      parentSessionId: scope.parentSessionId,
      role: args.role,
      goal: task,
      runId,
      attempt: 1,
      revision: 1,
      creationInvocation: { key: invocationKey, inputHash },
      providerId: resolvedTarget.providerId,
      selectedModelId,
      agentRuntimeType: resolvedTarget.runtime,
      reasoningLevel: parent.reasoningLevel,
      permissionMode,
    });
    const abortController = new AbortController();
    let resolveStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const live: LiveDelegation = {
      scope,
      meta: child,
      abortController,
      completion: Promise.resolve(),
      userMessageId: invocation.userMessageId,
      pendingInteractions: new Map(),
      resolvedInteractionHashes: new Map(),
      started,
      resolveStarted,
    };
    await runSessionCommand(delegationId, scope.workspaceId, async () => {
      this.live.set(delegationId, live);
      live.completion = this.execute(
        scope,
        child,
        buildDelegationPrompt({
          parentSessionId: scope.parentSessionId,
          delegationId,
          role: args.role,
          task: args.task,
          expectedOutput: args.expectedOutput,
        }),
        live
      );
      await Promise.race([live.started, live.completion]);
    });
    const created = this.toSummary(child);
    this.dependencies.emit({
      type: "subtask_snapshot",
      reason: "created",
      sessionId: scope.parentSessionId,
      subtask: created,
    });
    return created;
  }

  async wait(
    scope: DelegationScope,
    args: WaitArgs,
    signal?: AbortSignal
  ): Promise<WaitResult> {
    if (args.delegationIds.length === 0 || args.delegationIds.length > 20) {
      throw new Error("delegationIds must contain between 1 and 20 items.");
    }
    const mode = args.mode ?? "all";
    if (mode === "all" && args.minSettled !== undefined) {
      throw new Error("minSettled is only supported when mode is any.");
    }
    if (
      mode === "any" &&
      args.minSettled !== undefined &&
      args.minSettled > args.delegationIds.length
    ) {
      throw new Error("minSettled cannot exceed the number of delegationIds.");
    }
    const timeoutSeconds =
      args.timeoutSeconds ?? DEFAULT_DELEGATION_WAIT_TIMEOUT_SECONDS;
    if (
      !Number.isInteger(timeoutSeconds) ||
      timeoutSeconds < 1 ||
      timeoutSeconds > MAX_DELEGATION_WAIT_TIMEOUT_SECONDS
    ) {
      throw new Error(
        `timeoutSeconds must be an integer between 1 and ${MAX_DELEGATION_WAIT_TIMEOUT_SECONDS}.`
      );
    }
    let deadline = Date.now() + timeoutSeconds * 1_000;

    while (true) {
      const observedRevision = this.changeRevision;
      const subtasks = await Promise.all(
        args.delegationIds.map(async (id) => {
          const meta = await getSessionMeta(id, scope.workspaceId);
          if (!meta || meta.parentSessionId !== scope.parentSessionId) {
            throw new Error(`Delegation ${id} was not found in the current scope.`);
          }
          return this.toSummaryWithPersistedResult(meta, scope.workspaceId);
        })
      );
      const settledCount = subtasks.filter((item) => TERMINAL_STATUSES.has(item.status)).length;
      const runningCount = subtasks.length - settledCount;
      const blocked = subtasks
        .flatMap((subtask) =>
          subtask.pendingInteractions.map((blockedEvent) => ({ subtask, blockedEvent }))
        )
        .sort((left, right) => left.blockedEvent.createdAt - right.blockedEvent.createdAt)[0];
      if (blocked?.blockedEvent.type === "permission") {
        const suspendedAt = Date.now();
        await this.waitForChange(undefined, observedRevision, signal);
        deadline += Date.now() - suspendedAt;
        continue;
      }
      if (blocked) {
        return {
          status: "needs_input",
          delegationId: blocked.subtask.delegationId,
          blockedEvent: blocked.blockedEvent,
          subtask: blocked.subtask,
          nextAction: "respond_to_delegation",
        };
      }
      const minSettled = args.minSettled ?? (mode === "all" ? subtasks.length : 1);
      if (settledCount >= minSettled) {
        return { status: "settled", mode, settledCount, runningCount, subtasks };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { status: "timeout", mode, settledCount, runningCount, subtasks };
      }
      await this.waitForChange(remaining, observedRevision, signal);
    }
  }

  async startMany(
    scope: DelegationScope,
    args: DelegateManyArgs,
    invocation: DelegationInvocationContext
  ): Promise<DelegateManyResult> {
    if (args.tasks.length < 1 || args.tasks.length > 10) {
      throw new Error("tasks must contain between 1 and 10 items.");
    }
    const outcomes = await Promise.all(
      args.tasks.map(async (task, index) => {
        try {
          const normalizedTask = {
            ...task,
            task: buildDelegationTaskWithSharedContext({
              sharedContext: args.sharedContext,
              task: task.task,
            }),
          };
          const summary = await this.start(scope, normalizedTask, {
            ...invocation,
            invocationId: `${invocation.invocationId}:${index}`,
          });
          return { index, summary };
        } catch (error) {
          return {
            index,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );
    const result: DelegateManyResult = { created: [], failures: [] };
    for (const outcome of outcomes) {
      if (outcome.summary) {
        result.created.push(outcome.summary);
      } else {
        result.failures.push({
          index: outcome.index,
          code: "invalid_state",
          message: outcome.error ?? "Delegation creation failed.",
        });
      }
    }
    return result;
  }

  observeChildEvent(delegationId: string, event: AgentStreamEvent): void {
    const live = this.live.get(delegationId);
    if (!live) return;
    let blocked: SubtaskBlockedEvent | undefined;
    if (event.type === "permission_request") {
      blocked = {
        id: event.request.requestId,
        delegationId,
        runId: live.meta.delegationRunId!,
        type: "permission",
        request: event.request,
        createdAt: Date.now(),
      };
    } else if (event.type === "ask_user_request") {
      blocked = {
        id: event.request.requestId,
        delegationId,
        runId: live.meta.delegationRunId!,
        type: "ask_user",
        request: event.request,
        createdAt: Date.now(),
      };
    }
    if (blocked) {
      live.pendingInteractions.set(blocked.id, blocked);
      this.dependencies.emit({
        type: "subtask_snapshot",
        reason: "needs_input",
        sessionId: live.scope.parentSessionId,
        subtask: this.toSummary(live.meta),
      });
      this.notifyChange();
      return;
    }
    if (
      (event.type === "permission_resolved" || event.type === "ask_user_resolved") &&
      live.pendingInteractions.delete(event.requestId)
    ) {
      this.dependencies.emit({
        type: "subtask_snapshot",
        reason: "input_resolved",
        resolvedInteractionId: event.requestId,
        sessionId: live.scope.parentSessionId,
        subtask: this.toSummary(live.meta),
      });
      this.notifyChange();
    }
  }

  async respond(
    scope: DelegationScope,
    delegationId: string,
    blockedEventId: string,
    response: SubtaskBlockedResponse
  ): Promise<SubtaskRespondResult> {
    const live = this.live.get(delegationId);
    if (!live || live.scope.parentSessionId !== scope.parentSessionId) {
      return { status: "not_found" };
    }
    const hash = createHash("sha256").update(JSON.stringify(response)).digest("hex");
    const resolvedHash = live.resolvedInteractionHashes.get(blockedEventId);
    if (resolvedHash) {
      if (resolvedHash !== hash) {
        throw new Error("The blocked interaction was already resolved differently.");
      }
      return { status: "already_resolved", subtask: this.toSummary(live.meta) };
    }
    const blocked = live.pendingInteractions.get(blockedEventId);
    if (!blocked || blocked.runId !== live.meta.delegationRunId) {
      return { status: "not_found" };
    }
    if (blocked.type !== response.type) {
      throw new Error("The response type does not match the blocked interaction.");
    }
    const result = response.type === "permission"
      ? this.dependencies.respondPermission?.(
          blockedEventId,
          response.behavior,
          response.alwaysAllow ?? false,
          response.userMessage
        )
      : this.dependencies.answerQuestion?.(blockedEventId, response.answers);
    if (result !== "resolved") return { status: "not_found" };
    live.resolvedInteractionHashes.set(blockedEventId, hash);
    live.pendingInteractions.delete(blockedEventId);
    this.notifyChange();
    return { status: "resolved", subtask: this.toSummary(live.meta) };
  }

  async list(scope: DelegationScope): Promise<SubtaskSummary[]> {
    const sessions = await listSessions(scope.workspaceId, { includeArchived: true });
    return Promise.all(
      sessions
        .filter((session) => session.parentSessionId === scope.parentSessionId)
        .map((session) => this.toSummaryWithPersistedResult(session, scope.workspaceId))
    );
  }

  async get(scope: DelegationScope, delegationId: string): Promise<SubtaskSummary | null> {
    const meta = await getSessionMeta(delegationId, scope.workspaceId);
    if (!meta || meta.parentSessionId !== scope.parentSessionId) return null;
    return this.toSummaryWithPersistedResult(meta, scope.workspaceId);
  }

  async getResults(
    scope: DelegationScope,
    delegationIds: string[]
  ): Promise<DelegationResults> {
    const summaries = await Promise.all(
      delegationIds.map(async (delegationId) => {
        const summary = await this.get(scope, delegationId);
        if (!summary) throw new Error(`Delegation ${delegationId} was not found.`);
        return summary;
      })
    );
    return {
      results: summaries.map((summary) => ({
        delegationId: summary.delegationId,
        runId: summary.runId,
        status: summary.status,
        availability: summary.resultAvailability,
        resultSummary: summary.resultSummary,
        error:
          summary.resultAvailability === "unavailable"
            ? "Delegation result is unavailable."
            : summary.error,
        errorCode:
          summary.resultAvailability === "unavailable"
            ? "result_unavailable" as const
            : undefined,
        truncated: summary.resultTruncated === true,
      })),
    };
  }

  async stop(
    scope: DelegationScope,
    delegationId: string,
    expectedRunId: string
  ): Promise<SubtaskSummary> {
    const meta = await getSessionMeta(delegationId, scope.workspaceId);
    if (!meta || meta.parentSessionId !== scope.parentSessionId) {
      throw new Error(`Delegation ${delegationId} was not found.`);
    }
    if (meta.delegationRunId !== expectedRunId) {
      throw new Error("The delegation run changed before it could be stopped.");
    }
    if (meta.delegationStatus !== "running") {
      return this.toSummaryWithPersistedResult(meta, scope.workspaceId);
    }
    const live = this.live.get(delegationId);
    live?.abortController.abort();
    await this.dependencies.stop?.(delegationId, expectedRunId);
    await live?.completion;
    const stopped = await getSessionMeta(delegationId, scope.workspaceId);
    if (!stopped) throw new Error(`Delegation ${delegationId} was not found.`);
    return this.toSummary(stopped);
  }

  async interruptAll(): Promise<void> {
    const running = [...this.live.values()];
    for (const item of running) {
      item.interrupted = true;
      item.abortController.abort();
      await this.dependencies.stop?.(item.meta.id, item.meta.delegationRunId!);
    }
    await Promise.allSettled(running.map((item) => item.completion));
    this.live.clear();
    this.notifyChange();
  }

  async continueDelegation(
    scope: DelegationScope,
    delegationId: string,
    expectedRunId: string,
    message: string,
    invocation: DelegationInvocationContext
  ): Promise<SubtaskSummary> {
    return runSessionCommand(delegationId, scope.workspaceId, () =>
      this.continueDelegationUnlocked(
        scope,
        delegationId,
        expectedRunId,
        message,
        invocation
      )
    );
  }

  private async continueDelegationUnlocked(
    scope: DelegationScope,
    delegationId: string,
    expectedRunId: string,
    message: string,
    invocation: DelegationInvocationContext
  ): Promise<SubtaskSummary> {
    const normalizedMessage = message.trim();
    if (!normalizedMessage || normalizedMessage.length > 20_000) {
      throw new Error("message must contain between 1 and 20,000 characters.");
    }
    const meta = await getSessionMeta(delegationId, scope.workspaceId);
    if (!meta || meta.parentSessionId !== scope.parentSessionId) {
      throw new Error(`Delegation ${delegationId} was not found.`);
    }
    const invocationKey = `${scope.workspaceId}:${scope.parentSessionId}:continue_delegation:${invocation.invocationId}`;
    const inputHash = createHash("sha256")
      .update(JSON.stringify({ delegationId, expectedRunId, message: normalizedMessage }))
      .digest("hex");
    const previousInvocation = meta.delegationContinueInvocations?.find(
      (item) => item.key === invocationKey
    );
    if (previousInvocation) {
      if (previousInvocation.inputHash !== inputHash) {
        throw new Error("The continue invocation was reused with different input.");
      }
      return this.toSummary(meta);
    }
    if (meta.delegationRunId !== expectedRunId) {
      throw new Error("The delegation run changed before it could continue.");
    }
    if (meta.delegationStatus === "running") {
      throw new Error("The delegation is already running.");
    }
    const activeRun = this.dependencies.getRunInfo?.(delegationId);
    if (activeRun?.running) {
      throw new Error("child_session_busy");
    }
    const runId = randomUUID();
    const continueInvocations = [
      ...(meta.delegationContinueInvocations ?? []),
      { key: invocationKey, inputHash },
    ].slice(-32);
    await updateSessionMeta(
      delegationId,
      {
        delegationStatus: "running",
        delegationRunId: runId,
        delegationAttempt: (meta.delegationAttempt ?? 1) + 1,
        delegationRevision: (meta.delegationRevision ?? 0) + 1,
        delegationStartedAt: Date.now(),
        delegationCompletedAt: undefined,
        delegationError: undefined,
        delegationContinueInvocations: continueInvocations,
      },
      scope.workspaceId
    );
    const nextMeta = await getSessionMeta(delegationId, scope.workspaceId);
    if (!nextMeta) throw new Error(`Delegation ${delegationId} was not found.`);
    let resolveStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const live: LiveDelegation = {
      scope,
      meta: nextMeta,
      abortController: new AbortController(),
      completion: Promise.resolve(),
      userMessageId: invocation.userMessageId,
      pendingInteractions: new Map(),
      resolvedInteractionHashes: new Map(),
      started,
      resolveStarted,
    };
    this.live.set(delegationId, live);
    this.dependencies.emit({
      type: "subtask_snapshot",
      reason: "status_changed",
      sessionId: scope.parentSessionId,
      subtask: this.toSummary(nextMeta),
    });
    live.completion = this.execute(scope, nextMeta, normalizedMessage, live);
    await Promise.race([live.started, live.completion]);
    return this.toSummary(nextMeta);
  }

  private async execute(
    scope: DelegationScope,
    child: SessionMeta,
    prompt: string,
    live: LiveDelegation
  ): Promise<void> {
    requireRuntimeFields(child);
    if (!child.selectedModelId) {
      throw new Error("The delegated session does not have a resolved model target.");
    }
    let status: SubtaskStatus;
    let resultSummary: string | undefined;
    let error: string | undefined;
    try {
      if (!this.dependencies.getRunInfo) {
        live.resolveStarted();
      }
      const result = await this.dependencies.execute({
        workspaceId: scope.workspaceId,
        parentSessionId: scope.parentSessionId,
        childSession: child,
        prompt,
        runtime: child.agentRuntimeType,
        signal: live.abortController.signal,
        userMessageId: live.userMessageId,
        onRunStarted: live.resolveStarted,
      });
      status = live.interrupted
        ? "interrupted"
        : result.status === "stopped"
          ? "cancelled"
          : result.status;
      resultSummary = result.finalText?.trim() || undefined;
      error = live.interrupted
        ? "应用退出，运行已中断"
        : result.status === "failed"
          ? result.error
          : undefined;
      if (result.runtimeSessionId) {
        await updateSessionMeta(
          child.id,
          { sdkSessionId: result.runtimeSessionId },
          scope.workspaceId
        );
      }
    } catch (cause) {
      status = live.interrupted
        ? "interrupted"
        : live.abortController.signal.aborted
          ? "cancelled"
          : "failed";
      error = live.interrupted
        ? "应用退出，运行已中断"
        : cause instanceof Error
          ? cause.message
          : String(cause);
    }

    if (!resultSummary && status === "completed") resultSummary = EMPTY_COMPLETED_RESULT;
    let projectedResult: ReturnType<typeof truncateResultSummary> | undefined;
    if (resultSummary) {
      projectedResult = truncateResultSummary(resultSummary);
      live.resultSummary = projectedResult.resultSummary;
      live.resultTruncated = projectedResult.resultTruncated;
    } else {
      live.resultSummary = undefined;
      live.resultTruncated = false;
    }
    const current = await getSessionMeta(child.id, scope.workspaceId);
    if (!current || current.delegationRunId !== child.delegationRunId) {
      this.live.delete(child.id);
      this.notifyChange();
      return;
    }
    const completedAt = Date.now();
    await putTerminalResult(scope.workspaceId, {
      delegationId: child.id,
      runId: child.delegationRunId!,
      status: status as Exclude<SubtaskStatus, "running">,
      resultSummary: projectedResult?.resultSummary,
      resultTruncated: projectedResult?.resultTruncated ?? false,
      error,
      completedAt,
    });
    live.resultPersisted = true;
    await updateSessionMeta(
      child.id,
      {
        delegationStatus: status,
        delegationCompletedAt: completedAt,
        delegationError: error,
        delegationRevision: (current.delegationRevision ?? 0) + 1,
      },
      scope.workspaceId
    );
    const completed = await getSessionMeta(child.id, scope.workspaceId);
    if (!completed) {
      return;
    }
    live.meta = completed;
    this.dependencies.emit({
      type: "subtask_snapshot",
      reason: "status_changed",
      sessionId: scope.parentSessionId,
      subtask: this.toSummary(completed),
    });
    this.notifyChange();
  }

  private toSummary(meta: SessionMeta): SubtaskSummary {
    if (
      !meta.parentSessionId ||
      !meta.delegationRole ||
      !meta.delegationStatus ||
      !meta.delegationRunId ||
      !meta.providerId ||
      !meta.selectedModelId ||
      !meta.agentRuntimeType ||
      meta.delegationStartedAt === undefined
    ) {
      throw new Error(`Session ${meta.id} is not a delegated session.`);
    }
    const current = this.live.get(meta.id);
    return {
      delegationId: meta.id,
      parentSessionId: meta.parentSessionId,
      title: meta.title,
      role: meta.delegationRole,
      status: meta.delegationStatus,
      interactionState:
        current && current.pendingInteractions.size > 0 ? "needs_input" : "none",
      runId: meta.delegationRunId,
      attempt: meta.delegationAttempt ?? 1,
      providerId: meta.providerId,
      modelId: meta.selectedModelId,
      agentRuntimeType: meta.agentRuntimeType,
      permissionMode: meta.permissionMode ?? "ask",
      startedAt: meta.delegationStartedAt,
      completedAt: meta.delegationCompletedAt,
      error: meta.delegationError,
      resultSummary: current?.resultSummary,
      resultTruncated: current?.resultTruncated,
      resultAvailability:
        meta.delegationStatus === "running"
          ? "pending"
          : current?.resultPersisted
            ? "available"
            : "unavailable",
      pendingInteractions: current
        ? [...current.pendingInteractions.values()].sort(
            (left, right) => left.createdAt - right.createdAt
          )
        : [],
      revision: meta.delegationRevision ?? 0,
    };
  }

  private async toSummaryWithPersistedResult(
    meta: SessionMeta,
    workspaceId: string
  ): Promise<SubtaskSummary> {
    const summary = this.toSummary(meta);
    if (!TERMINAL_STATUSES.has(summary.status)) return summary;
    const result = await getResult(workspaceId, meta.id, summary.runId);
    if (!result) {
      return {
        ...summary,
        resultSummary: undefined,
        resultTruncated: false,
        resultAvailability: "unavailable",
      };
    }
    return {
      ...summary,
      resultSummary: result.resultSummary,
      resultTruncated: result.resultTruncated,
      resultAvailability: "available",
      error: result.error ?? summary.error,
    };
  }

  private waitForChange(
    timeoutMs: number | undefined,
    observedRevision: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.changeRevision !== observedRevision) return Promise.resolve();
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new Error("Delegation wait was aborted."));
    }
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        this.listeners.delete(listener);
        signal?.removeEventListener("abort", onAbort);
      };
      const listener = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(signal?.reason ?? new Error("Delegation wait was aborted."));
      };
      timer = timeoutMs === undefined ? undefined : setTimeout(listener, timeoutMs);
      this.listeners.add(listener);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (this.changeRevision !== observedRevision) listener();
    });
  }

  private notifyChange(): void {
    this.changeRevision += 1;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

export class ScopedDelegationCoordinator {
  constructor(
    private readonly coordinator: DelegationCoordinator,
    private readonly scope: DelegationScope
  ) {}

  start(args: DelegateArgs, invocation: DelegationInvocationContext) {
    return this.coordinator.start(this.scope, args, invocation);
  }

  startMany(args: DelegateManyArgs, invocation: DelegationInvocationContext) {
    return this.coordinator.startMany(this.scope, args, invocation);
  }

  wait(args: WaitArgs, signal?: AbortSignal) {
    return this.coordinator.wait(this.scope, args, signal);
  }


  list() {
    return this.coordinator.list(this.scope);
  }

  get(delegationId: string) {
    return this.coordinator.get(this.scope, delegationId);
  }

  getResults(delegationIds: string[]) {
    return this.coordinator.getResults(this.scope, delegationIds);
  }

  stop(delegationId: string, expectedRunId: string) {
    return this.coordinator.stop(this.scope, delegationId, expectedRunId);
  }

  continueDelegation(
    delegationId: string,
    expectedRunId: string,
    message: string,
    invocation: DelegationInvocationContext
  ) {
    return this.coordinator.continueDelegation(
      this.scope,
      delegationId,
      expectedRunId,
      message,
      invocation
    );
  }


  respond(
    delegationId: string,
    blockedEventId: string,
    response: SubtaskBlockedResponse
  ) {
    return this.coordinator.respond(
      this.scope,
      delegationId,
      blockedEventId,
      response
    );
  }
}
