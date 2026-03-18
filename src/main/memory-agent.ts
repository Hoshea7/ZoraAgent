import type { ChatMessage } from "../shared/zora";
import {
  isAgentRunningForSession,
  resolveSDKCliPath,
  runAgentWithProfile,
} from "./agent";
import { getZoraDirPath } from "./memory-store";
import { buildMemoryProfile } from "./query-profiles";
import { listSessions, loadMessages } from "./session-store";

const MEMORY_PROCESS_DEBOUNCE_MS = 5 * 60 * 1000;
const USER_MESSAGE_MAX_CHARS = 500;
const ASSISTANT_MESSAGE_MAX_CHARS = 300;
const MEMORY_MESSAGE_LIMIT = 40;
const MEMORY_MESSAGE_HEAD = 6;
const MEMORY_MESSAGE_TAIL = 20;
const MEMORY_AGENT_PREFIX = "[memory-agent]";

type PendingSessionContext = {
  workspaceId: string;
  zoraId: string;
};

type MemoryPromptBuildResult = {
  prompt: string;
  totalTranscriptMessages: number;
  keptTranscriptMessages: number;
  omittedTranscriptMessages: number;
};

function padNumber(value: number) {
  return value.toString().padStart(2, "0");
}

function formatLocalDate(date = new Date()) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function formatLocalTime(date = new Date()) {
  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

function truncateText(value: string, maxChars: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxChars)}...`;
}

function logMemoryAgent(message: string) {
  console.log(`${MEMORY_AGENT_PREFIX} ${message}`);
}

function serializeMemoryMessage(message: ChatMessage): string | null {
  if (message.role === "user" && message.type === "text") {
    const text = truncateText(message.text, USER_MESSAGE_MAX_CHARS);
    return text ? `**User**: ${text}` : null;
  }

  if (message.role === "assistant" && message.type === "text") {
    const text = truncateText(message.text, ASSISTANT_MESSAGE_MAX_CHARS);
    return text ? `**Zora**: ${text}` : null;
  }

  return null;
}

function buildMemoryPrompt(
  messages: ChatMessage[],
  sessionTitle: string
): MemoryPromptBuildResult {
  const now = new Date();
  const serializedMessages = messages
    .map((message) => serializeMemoryMessage(message))
    .filter((message): message is string => Boolean(message));
  const visibleMessages =
    serializedMessages.length > MEMORY_MESSAGE_LIMIT
      ? [
          ...serializedMessages.slice(0, MEMORY_MESSAGE_HEAD),
          "... (earlier exchanges omitted) ...",
          ...serializedMessages.slice(-MEMORY_MESSAGE_TAIL),
        ]
      : serializedMessages;

  const transcript = visibleMessages.join("\n\n");

  return {
    prompt: [
      "## Conversation to Process",
      "",
      `**Session**: ${sessionTitle}`,
      `**Date**: ${formatLocalDate(now)}`,
      `**Time**: ${formatLocalTime(now)}`,
      "",
      transcript,
      "",
      "Please analyze this conversation and update memory files as needed.",
      "If nothing worth remembering happened, just write a brief daily log and finish.",
    ].join("\n"),
    totalTranscriptMessages: serializedMessages.length,
    keptTranscriptMessages: visibleMessages.length,
    omittedTranscriptMessages: Math.max(0, serializedMessages.length - visibleMessages.length),
  };
}

export class MemoryAgent {
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly processing = new Set<string>();
  private readonly processedMessageCounts = new Map<string, number>();
  private readonly pendingContexts = new Map<string, PendingSessionContext>();
  private queue: Promise<void> = Promise.resolve();

  async onConversationEnd(
    sessionId: string,
    workspaceId = "default",
    zoraId = "default"
  ): Promise<void> {
    this.pendingContexts.set(sessionId, { workspaceId, zoraId });
    this.clearDebounceTimer(sessionId);
    logMemoryAgent(
      this.processing.has(sessionId)
        ? `Conversation ended for session ${sessionId}; queued a follow-up memory recheck after the current run.`
        : `Conversation ended for session ${sessionId}; queued memory processing.`
    );
    this.enqueueProcess(sessionId, workspaceId, zoraId);
  }

  scheduleProcessing(
    sessionId: string,
    workspaceId = "default",
    zoraId = "default"
  ): void {
    this.pendingContexts.set(sessionId, { workspaceId, zoraId });
    const hadExistingTimer = this.debounceTimers.has(sessionId);
    this.clearDebounceTimer(sessionId);
    logMemoryAgent(
      `${hadExistingTimer ? "Rescheduled" : "Scheduled"} session ${sessionId} for memory processing in ${Math.floor(MEMORY_PROCESS_DEBOUNCE_MS / 1000)}s.`
    );

    const timer = setTimeout(() => {
      this.debounceTimers.delete(sessionId);

      if (isAgentRunningForSession(sessionId)) {
        logMemoryAgent(
          `Session ${sessionId} is still running when debounce fired; delaying memory processing.`
        );
        this.scheduleProcessing(sessionId, workspaceId, zoraId);
        return;
      }

      logMemoryAgent(
        `Debounce window elapsed for session ${sessionId}; queued memory processing.`
      );
      this.enqueueProcess(sessionId, workspaceId, zoraId);
    }, MEMORY_PROCESS_DEBOUNCE_MS);

    this.debounceTimers.set(sessionId, timer);
  }

  async flushAll(): Promise<void> {
    logMemoryAgent(
      `Flushing pending memory work: timers=${this.debounceTimers.size}.`
    );

    for (const [sessionId, timer] of this.debounceTimers) {
      clearTimeout(timer);
      this.debounceTimers.delete(sessionId);

      const context = this.pendingContexts.get(sessionId);
      if (!context) {
        continue;
      }

      if (this.processing.has(sessionId)) {
        logMemoryAgent(
          `Flush observed session ${sessionId} already in memory processing; waiting for the queue.`
        );
        continue;
      }

      logMemoryAgent(`Flush queued memory processing for session ${sessionId}.`);
      this.enqueueProcess(sessionId, context.workspaceId, context.zoraId);
    }

    await this.queue;
    logMemoryAgent("Flush complete.");
  }

  private clearDebounceTimer(sessionId: string) {
    const timer = this.debounceTimers.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.debounceTimers.delete(sessionId);
  }

  private enqueueProcess(
    sessionId: string,
    workspaceId = "default",
    zoraId = "default"
  ) {
    this.pendingContexts.set(sessionId, { workspaceId, zoraId });
    this.queue = this.queue
      .then(() => this.process(sessionId, workspaceId, zoraId))
      .catch((error) => {
        console.error(
          `${MEMORY_AGENT_PREFIX} Queue failure for session ${sessionId}:`,
          error
        );
      });
  }

  private process(
    sessionId: string,
    workspaceId = "default",
    zoraId = "default"
  ): Promise<void> {
    if (this.processing.has(sessionId)) {
      logMemoryAgent(`Skip session ${sessionId}: processing already in progress.`);
      return Promise.resolve();
    }

    if (sessionId === "__awakening__") {
      logMemoryAgent("Skip awakening session for memory extraction.");
      return Promise.resolve();
    }

    if (sessionId.startsWith("__memory_")) {
      logMemoryAgent(`Skip nested memory session ${sessionId}.`);
      return Promise.resolve();
    }

    return (async () => {
      const startedAt = Date.now();
      this.processing.add(sessionId);
      logMemoryAgent(
        `Begin processing session ${sessionId} (workspace=${workspaceId}, zoraId=${zoraId}).`
      );

      try {
        const messages = await loadMessages(sessionId, workspaceId);
        logMemoryAgent(
          `Loaded ${messages.length} persisted message(s) for session ${sessionId}.`
        );
        if (messages.length < 4) {
          logMemoryAgent(
            `Skip session ${sessionId}: only ${messages.length} message(s), below threshold.`
          );
          return;
        }

        const lastProcessedCount = this.processedMessageCounts.get(sessionId);
        if (lastProcessedCount !== undefined && lastProcessedCount >= messages.length) {
          logMemoryAgent(
            `Session ${sessionId} unchanged (${messages.length} message(s)); skipping.`
          );
          return;
        }

        const sessions = await listSessions(workspaceId);
        const sessionTitle =
          sessions.find((session) => session.id === sessionId)?.title ?? "Untitled Session";
        const {
          prompt,
          totalTranscriptMessages,
          keptTranscriptMessages,
          omittedTranscriptMessages,
        } = buildMemoryPrompt(messages, sessionTitle);
        if (keptTranscriptMessages === 0) {
          logMemoryAgent(
            `Skip session ${sessionId}: no text transcript eligible for memory extraction.`
          );
          return;
        }

        logMemoryAgent(
          `Built memory prompt for session ${sessionId}: transcript=${keptTranscriptMessages}/${totalTranscriptMessages}, omitted=${omittedTranscriptMessages}, chars=${prompt.length}, title="${sessionTitle}".`
        );
        const targetZoraDir = getZoraDirPath(zoraId);
        const memorySessionId = `__memory_${sessionId}__`;

        logMemoryAgent(
          `Starting memory run ${memorySessionId} for session ${sessionId} in ${targetZoraDir}.`
        );

        const profile = await buildMemoryProfile({
          sdkCliPath: resolveSDKCliPath(),
          zoraId,
          prompt,
        });

        await runAgentWithProfile(
          memorySessionId,
          profile,
          () => {},
          undefined,
          workspaceId
        );
        this.processedMessageCounts.set(sessionId, messages.length);

        logMemoryAgent(
          `Completed memory run for session ${sessionId} in ${Date.now() - startedAt}ms.`
        );
      } catch (error) {
        console.error(
          `${MEMORY_AGENT_PREFIX} Failed to process session ${sessionId}:`,
          error
        );
      } finally {
        this.processing.delete(sessionId);
        this.pendingContexts.delete(sessionId);
      }
    })();
  }
}

export const memoryAgent = new MemoryAgent();
