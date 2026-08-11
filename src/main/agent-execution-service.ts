import type { AgentRunInfo } from "../shared/zora";
import { logAgentEvent } from "./agent-loop-log";
import { memoryAgent } from "./memory-agent";
import { agentRuntimeRouter, type AgentRuntimeRouter } from "./runtime";
import type {
  RuntimeQueryInput,
  AgentRuntimeQueuedMessage,
  AgentRuntimeHandle,
  AgentRuntimeResult,
} from "./runtime/types";
import { ProductivityProfile } from "./agent-profiles";
import { createUnattendedToolGate } from "./runtime/tool-gate";
import { ProductToolGate } from "./hitl/tool-gate";
import { clearPendingForSession } from "./hitl";
import { getErrorMessage } from "./system-log";
import { isRecord } from "./utils/guards";

function assistantTextFromEvent(event: RuntimeQueryInput["forwardEvent"] extends (event: infer T) => void ? T : never): string | undefined {
  if (event.type !== "assistant" || !isRecord(event.message)) return undefined;
  const content = event.message.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n")
    .trim();
  return text || undefined;
}

interface ActiveRun {
  agentRuntimeType: RuntimeQueryInput["target"]["agentRuntimeType"];
  source: RuntimeQueryInput["source"];
  handle?: AgentRuntimeHandle;
  stopped: boolean;
  queuedMessages: AgentRuntimeQueuedMessage[];
}

export class AgentExecutionService {
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(
    private readonly runtimes: AgentRuntimeRouter,
    private readonly productivityProfile = new ProductivityProfile(),
    private readonly onConversationEnd = (
      sessionId: string,
      workspaceId: string
    ) => memoryAgent.onConversationEnd(sessionId, workspaceId)
  ) {}

  async execute(input: RuntimeQueryInput): Promise<AgentRuntimeResult> {
    if (this.activeRuns.has(input.sessionId)) {
      throw new Error(`An agent is already running for session ${input.sessionId}.`);
    }

    const activeRun: ActiveRun = {
      agentRuntimeType: input.target.agentRuntimeType,
      source: input.source,
      stopped: false,
      queuedMessages: [],
    };
    this.activeRuns.set(input.sessionId, activeRun);

    try {
      let finalText: string | undefined;
      let runtimeSessionId: string | undefined;
      const harness = await this.productivityProfile.prepare({
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        prompt: input.prompt,
        cwd: input.workingDirectory?.trim() || process.cwd(),
        permissionMode: input.permissionMode ?? "interactive",
        modelOverrides: input.reasoningLevel
          ? { reasoningLevel: input.reasoningLevel }
          : undefined,
      });
      if (activeRun.stopped) return { status: "stopped" };

      const handle = this.runtimes.start({
        harness,
        target: input.target,
        toolGate:
          harness.permissions.mode === "interactive"
            ? new ProductToolGate(
                input.forwardEvent,
                harness.sessionId,
                new Set(
                  input.toolProvisioningPlan.tools
                    .filter((tool) => tool.approvalPolicy === "auto")
                    .map((tool) => tool.canonicalName)
                )
              )
            : createUnattendedToolGate(),
        attachments: input.attachments,
        source: input.source,
        forwardEvent: (event) => {
          finalText = assistantTextFromEvent(event) ?? finalText;
          if ("session_id" in event && typeof event.session_id === "string") {
            runtimeSessionId = event.session_id;
          }
          input.forwardEvent(event);
        },
        toolProvisioningPlan: input.toolProvisioningPlan,
        vision: input.vision,
      });
      activeRun.handle = handle;
      for (const message of activeRun.queuedMessages.splice(0)) {
        await handle.enqueue(message);
      }
      const result = await handle.completion;
      if (result.status === "completed") {
        logAgentEvent("post", "memory", "已触发记忆处理检查", {
          MemoryAgent: "check",
          reason: "conversation_end",
          runtime: input.target.agentRuntimeType,
        });
        void this.onConversationEnd(input.sessionId, input.workspaceId).catch(
          (error) => {
            logAgentEvent(
              "post",
              "memory",
              "记忆处理检查失败",
              {
                status: "error",
                reason: error instanceof Error ? error.message : String(error),
                runtime: input.target.agentRuntimeType,
              },
              { level: "error" }
            );
          }
        );
      }
      return {
        ...result,
        finalText: result.finalText ?? finalText,
        runtimeSessionId: result.runtimeSessionId ?? runtimeSessionId,
      };
    } catch (error) {
      if (input.source === "delegation") {
        return { status: "failed", error: getErrorMessage(error) };
      }
      throw error;
    } finally {
      clearPendingForSession(input.sessionId);
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

  async enqueue(sessionId: string, message: AgentRuntimeQueuedMessage): Promise<void> {
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
      ? { running: true, source: activeRun.source, agentRuntimeType: activeRun.agentRuntimeType }
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

export const agentExecutionService = new AgentExecutionService(agentRuntimeRouter);
