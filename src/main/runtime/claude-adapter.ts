import { sendQueuedMessage, stopAgentForSession } from "../agent";
import { runProductivitySession } from "../productivity-runner";
import type {
  RuntimeAdapter,
  RuntimeStartInput,
  RuntimeQueuedMessage,
  RuntimeRunHandle,
} from "./types";

export class ClaudeRuntimeAdapter implements RuntimeAdapter {
  readonly type = "claude" as const;

  start(input: RuntimeStartInput): RuntimeRunHandle {
    const { harness } = input;
    let started = false;
    let stopped = false;
    const queuedBeforeReady: RuntimeQueuedMessage[] = [];

    const flushQueuedMessages = async (): Promise<void> => {
      while (queuedBeforeReady.length > 0 && !stopped) {
        const message = queuedBeforeReady.shift();
        if (!message) continue;
        await sendQueuedMessage(harness.sessionId, message.text, message.id);
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
        input.forwardEvent(event);
      },
      attachments: input.attachments,
      source: input.source,
      executionTarget: input.target,
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
        await sendQueuedMessage(harness.sessionId, message.text, message.id);
      },
    };
  }

  dispose(): void {
    // Claude runtime doesn't hold external resources that need cleanup.
  }
}
