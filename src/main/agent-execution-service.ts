import type { AgentRunInfo } from "../shared/zora";
import { runtimeRouter, type RuntimeRouter } from "./runtime";
import type {
  RuntimeQueryInput,
  RuntimeQueuedMessage,
  RuntimeRunHandle,
} from "./runtime/types";
import { ProductivityProfile } from "./agent-profiles";

interface ActiveRun {
  runtimeType: RuntimeQueryInput["target"]["runtimeType"];
  source: RuntimeQueryInput["source"];
  handle?: RuntimeRunHandle;
  stopped: boolean;
  queuedMessages: RuntimeQueuedMessage[];
}

export class AgentExecutionService {
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(
    private readonly runtimes: RuntimeRouter,
    private readonly productivityProfile = new ProductivityProfile()
  ) {}

  async execute(input: RuntimeQueryInput): Promise<void> {
    if (this.activeRuns.has(input.sessionId)) {
      throw new Error(`An agent is already running for session ${input.sessionId}.`);
    }

    const activeRun: ActiveRun = {
      runtimeType: input.target.runtimeType,
      source: input.source,
      stopped: false,
      queuedMessages: [],
    };
    this.activeRuns.set(input.sessionId, activeRun);

    try {
      const harness = await this.productivityProfile.prepare({
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        prompt: input.prompt,
        cwd: input.workingDirectory?.trim() || process.cwd(),
        permissionMode: input.permissionMode ?? "default",
        modelOverrides: input.reasoningEffort
          ? { reasoningEffort: input.reasoningEffort }
          : undefined,
      });
      if (activeRun.stopped) return;

      const handle = this.runtimes.start({
        harness,
        target: input.target,
        attachments: input.attachments,
        source: input.source,
        forwardEvent: input.forwardEvent,
      });
      activeRun.handle = handle;
      for (const message of activeRun.queuedMessages.splice(0)) {
        await handle.enqueue(message);
      }
      await handle.completion;
    } finally {
      if (this.activeRuns.get(input.sessionId) === activeRun) {
        this.activeRuns.delete(input.sessionId);
      }
    }
  }

  async stop(sessionId: string): Promise<void> {
    const activeRun = this.activeRuns.get(sessionId);
    if (!activeRun || activeRun.stopped) return;
    activeRun.stopped = true;
    activeRun.queuedMessages.length = 0;
    await activeRun.handle?.abort();
  }

  async enqueue(sessionId: string, message: RuntimeQueuedMessage): Promise<void> {
    const activeRun = this.activeRuns.get(sessionId);
    if (!activeRun) {
      throw new Error("会话未运行，无法追加消息");
    }
    if (activeRun.stopped) {
      throw new Error("会话已停止，无法追加消息");
    }
    if (activeRun.handle) {
      await activeRun.handle.enqueue(message);
    } else {
      activeRun.queuedMessages.push(message);
    }
  }

  isRunning(sessionId: string): boolean {
    return this.activeRuns.has(sessionId);
  }

  getRunInfo(sessionId: string): AgentRunInfo {
    const activeRun = this.activeRuns.get(sessionId);
    return activeRun
      ? { running: true, source: activeRun.source, runtimeType: activeRun.runtimeType }
      : { running: false };
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.activeRuns.values()].map(async (run) => {
        run.stopped = true;
        await run.handle?.abort();
      })
    );
    this.activeRuns.clear();
    this.runtimes.dispose();
  }
}

export const agentExecutionService = new AgentExecutionService(runtimeRouter);
