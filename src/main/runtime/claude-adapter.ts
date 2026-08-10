import { sendQueuedMessage, stopAgentForSession } from "../agent";
import { runProductivitySession } from "../productivity-runner";
import type {
  AgentRuntimeAdapter,
  AgentRuntimeInput,
  AgentRuntimeQueuedMessage,
  AgentRuntimeHandle,
} from "./types";

export class ClaudeAgentRuntimeAdapter implements AgentRuntimeAdapter {
  readonly type = "claude" as const;

  start(input: AgentRuntimeInput): AgentRuntimeHandle {
    const { harness } = input;
    let started = false;
    let stopped = false;
    const queuedBeforeReady: AgentRuntimeQueuedMessage[] = [];

    const flushQueuedMessages = async (): Promise<void> => {
      while (queuedBeforeReady.length > 0 && !stopped) {
        const message = queuedBeforeReady.shift();
        if (!message) continue;
        await sendQueuedMessage(
          harness.sessionId,
          message.text,
          message.id,
          message.attachments
        );
        input.forwardEvent({ type: "queued_message_accepted", uuid: message.id });
      }
    };

    const completion = runProductivitySession({
      harness,
      forwardEvent: (event) => {
        if (event.type === "agent_status" && event.status === "started") {
          started = true;
          if (stopped) {
            void stopAgentForSession(harness.sessionId);
          } else {
            void flushQueuedMessages();
          }
        }
        if (
          event.type === "user" &&
          event.isReplay === true &&
          typeof event.uuid === "string"
        ) {
          input.forwardEvent({ type: "queued_message_started", uuid: event.uuid });
        }
        input.forwardEvent(event);
      },
      attachments: input.attachments,
      source: input.source,
      executionTarget: input.target,
      toolGate: input.toolGate,
      toolRunContext: {
        workspaceId: harness.workspaceId,
        sessionId: harness.sessionId,
        runtime: "claude",
        mainModel: {
          providerId: input.target.provider.id,
          modelId: input.target.modelId,
        },
        runOrigin: input.source,
        ...input.vision,
      },
    }).then(() => ({ status: stopped ? "stopped" : "completed" }) as const);

    return {
      completion,
      abort: async () => {
        stopped = true;
        queuedBeforeReady.length = 0;
        if (started) {
          await stopAgentForSession(harness.sessionId);
        }
      },
      enqueue: async (message) => {
        if (stopped) {
          throw new Error("会话已停止，无法追加消息");
        }
        if (!started) {
          queuedBeforeReady.push(message);
          return;
        }
        await sendQueuedMessage(
          harness.sessionId,
          message.text,
          message.id,
          message.attachments
        );
        input.forwardEvent({ type: "queued_message_accepted", uuid: message.id });
      },
    };
  }

  deleteSessionData(_sessionId: string, _workspaceId: string): void {
    // Claude SDK transcript lifecycle is owned by the Claude SDK.
  }

  dispose(): void {
    // Claude runtime doesn't hold external resources that need cleanup.
  }
}
