import type { ConversationMessage } from "../shared/zora";
import {
  isAgentRunningForSession,
  runAgentWithProfile,
} from "./agent";
import {
  getMemorySettingsSync,
  loadMemorySettings,
} from "./memory-settings";
import { loadFile } from "./memory-store";
import { buildMemoryProfile } from "./query-profiles";
import { prepareMemoryHarness } from "./agent-profiles";
import { getSDKRuntimeOptions } from "./sdk-runtime";
import { listSessions, loadMessages } from "./session-store";
import {
  formatDurationMs,
  logAgentEvent,
  logAgentLoopEnd,
  logAgentLoopStart,
} from "./agent-loop-log";
import { getErrorMessage } from "./system-log";

const MEMORY_PROCESS_DEBOUNCE_MS = 10 * 60 * 1000;
const MEMORY_DISABLED_REASON = "memory_disabled";
const BATCH_QUEUE_MAX_SIZE = 8;
const USER_MESSAGE_MAX_CHARS = 500;
const ASSISTANT_MESSAGE_MAX_CHARS = 300;
const MEMORY_MESSAGE_LIMIT = 40;
const MEMORY_MESSAGE_HEAD = 6;
const MEMORY_MESSAGE_TAIL = 20;
const BATCH_USER_MESSAGE_MAX_CHARS = 300;
const BATCH_ASSISTANT_MESSAGE_MAX_CHARS = 200;
const BATCH_MESSAGE_LIMIT = 20;
const BATCH_MESSAGE_HEAD = 4;
const BATCH_MESSAGE_TAIL = 12;
type PendingSessionContext = {
  workspaceId: string;
  enqueuedAt: number;
};

type PendingSessionItem = {
  sessionId: string;
  context: PendingSessionContext;
};

type MemoryPromptBuildResult = {
  prompt: string;
  totalTranscriptMessages: number;
  keptTranscriptMessages: number;
  omittedTranscriptMessages: number;
};

type TranscriptLimits = {
  userMaxChars: number;
  assistantMaxChars: number;
  messageLimit: number;
  head: number;
  tail: number;
};

type SerializedTranscript = {
  visibleMessages: string[];
  totalMessages: number;
  keptMessages: number;
  omittedMessages: number;
};

const SINGLE_TRANSCRIPT_LIMITS: TranscriptLimits = {
  userMaxChars: USER_MESSAGE_MAX_CHARS,
  assistantMaxChars: ASSISTANT_MESSAGE_MAX_CHARS,
  messageLimit: MEMORY_MESSAGE_LIMIT,
  head: MEMORY_MESSAGE_HEAD,
  tail: MEMORY_MESSAGE_TAIL,
};

const BATCH_TRANSCRIPT_LIMITS: TranscriptLimits = {
  userMaxChars: BATCH_USER_MESSAGE_MAX_CHARS,
  assistantMaxChars: BATCH_ASSISTANT_MESSAGE_MAX_CHARS,
  messageLimit: BATCH_MESSAGE_LIMIT,
  head: BATCH_MESSAGE_HEAD,
  tail: BATCH_MESSAGE_TAIL,
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

function serializeMemoryMessage(
  message: ConversationMessage,
  userMaxChars = USER_MESSAGE_MAX_CHARS,
  assistantMaxChars = ASSISTANT_MESSAGE_MAX_CHARS
): string | null {
  if (message.role === "user") {
    const text = truncateText(message.text ?? "", userMaxChars);
    return text ? `**User**: ${text}` : null;
  }

  if (message.role === "assistant" && message.turn) {
    const text = truncateText(
      message.turn.bodySegments.map((segment) => segment.text).join("\n\n"),
      assistantMaxChars
    );
    return text ? `**Zora**: ${text}` : null;
  }

  return null;
}

function serializeTranscript(
  messages: ConversationMessage[],
  limits: TranscriptLimits
): SerializedTranscript {
  const serializedMessages = messages
    .map((message) =>
      serializeMemoryMessage(
        message,
        limits.userMaxChars,
        limits.assistantMaxChars
      )
    )
    .filter((message): message is string => Boolean(message));

  const visibleMessages =
    serializedMessages.length > limits.messageLimit
      ? [
          ...serializedMessages.slice(0, limits.head),
          "... (earlier exchanges omitted) ...",
          ...serializedMessages.slice(-limits.tail),
        ]
      : serializedMessages;

  return {
    visibleMessages,
    totalMessages: serializedMessages.length,
    keptMessages: visibleMessages.length,
    omittedMessages: Math.max(0, serializedMessages.length - visibleMessages.length),
  };
}

function buildMemoryStateSection(
  memoryContent: string | null,
  userContent: string | null
) {
  return [
    "## Current Memory State",
    "",
    "### MEMORY.md",
    memoryContent?.trim() || "(empty — not created yet)",
    "",
    "### USER.md",
    userContent?.trim() || "(empty — not created yet)",
  ].join("\n");
}

function buildMemoryPrompt(
  messages: ConversationMessage[],
  sessionTitle: string,
  memoryContent: string | null,
  userContent: string | null,
  conversationTime?: Date
): MemoryPromptBuildResult {
  const now = new Date();
  const effectiveTime = conversationTime ?? now;
  const transcript = serializeTranscript(messages, SINGLE_TRANSCRIPT_LIMITS);

  const memoryStateSection = buildMemoryStateSection(memoryContent, userContent);

  return {
    prompt: [
      memoryStateSection,
      "",
      "## Conversation to Process",
      "",
      `**Session**: ${sessionTitle}`,
      `**Date**: ${formatLocalDate(effectiveTime)}`,
      `**Time**: ${formatLocalTime(effectiveTime)}`,
      "",
      transcript.visibleMessages.join("\n\n"),
      "",
      "Please analyze this conversation and update memory files as needed.",
      "If nothing worth remembering happened, just write a brief daily log and finish.",
    ].join("\n"),
    totalTranscriptMessages: transcript.totalMessages,
    keptTranscriptMessages: transcript.keptMessages,
    omittedTranscriptMessages: transcript.omittedMessages,
  };
}

type BatchConversationEntry = {
  sessionTitle: string;
  messages: ConversationMessage[];
  conversationTime: Date;
};

function buildBatchMemoryPrompt(
  entries: BatchConversationEntry[],
  memoryContent: string | null,
  userContent: string | null
): MemoryPromptBuildResult {
  const sections: string[] = [];
  let totalMessages = 0;
  let keptMessages = 0;
  let omittedMessages = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const transcript = serializeTranscript(entry.messages, BATCH_TRANSCRIPT_LIMITS);

    totalMessages += transcript.totalMessages;
    keptMessages += transcript.keptMessages;
    omittedMessages += transcript.omittedMessages;

    sections.push(
      [
        `### Conversation ${i + 1} of ${entries.length}`,
        "",
        `**Session**: ${entry.sessionTitle}`,
        `**Date**: ${formatLocalDate(entry.conversationTime)}`,
        `**Time**: ${formatLocalTime(entry.conversationTime)}`,
        "",
        transcript.visibleMessages.join("\n\n"),
      ].join("\n")
    );
  }

  const prompt = [
    buildMemoryStateSection(memoryContent, userContent),
    "",
    "## Batch: Multiple Conversations to Process",
    "",
    `You have **${entries.length}** conversations to analyze in this batch.`,
    "Process each one, then make a **single consolidated update** to memory files.",
    "Write a separate daily-log entry for each conversation.",
    "",
    sections.join("\n\n---\n\n"),
    "",
    "---",
    "",
    "Please analyze ALL conversations above and make consolidated memory updates.",
    "Merge related information across conversations. Avoid duplicate entries.",
    "If nothing worth remembering happened in a conversation, write only its daily log.",
  ].join("\n");

  return {
    prompt,
    totalTranscriptMessages: totalMessages,
    keptTranscriptMessages: keptMessages,
    omittedTranscriptMessages: omittedMessages,
  };
}

export class MemoryAgent {
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly processing = new Set<string>();
  private readonly processedMessageCounts = new Map<string, number>();
  private readonly pendingContexts = new Map<string, PendingSessionContext>();
  private batchIdleTimer: NodeJS.Timeout | null = null;
  private pendingChangeCallback?: (count: number) => void;
  private queue: Promise<void> = Promise.resolve();

  async onConversationEnd(
    sessionId: string,
    workspaceId = "default"
  ): Promise<void> {
    const settings = await loadMemorySettings();
    if (!settings.enabled) {
      this.clearSessionWorkForDisabledMemory(sessionId, workspaceId);
      return;
    }

    const messages = await loadMessages(sessionId, workspaceId);
    if (messages.length < 4) {
      this.clearDebounceTimer(sessionId);
      this.deletePendingContext(sessionId);
      logAgentEvent(
        "pre",
        "skip",
        "记忆任务跳过",
        { session: sessionId, workspace: workspaceId, reason: "below_threshold", messages: messages.length },
        { agentType: "memory", verbose: true }
      );
      return;
    }

    switch (settings.mode) {
      case "manual":
        this.trackPendingSession(sessionId, workspaceId);
        this.clearDebounceTimer(sessionId);
        logAgentEvent(
          "pre",
          "queued",
          "记忆任务已暂存",
          { session: sessionId, workspace: workspaceId, mode: "manual", pending: this.pendingContexts.size },
          { agentType: "memory" }
        );
        return;

      case "batch":
        this.trackPendingSession(sessionId, workspaceId);
        this.clearDebounceTimer(sessionId);
        logAgentEvent(
          "pre",
          "queued",
          "记忆任务已加入批处理队列",
          { session: sessionId, workspace: workspaceId, mode: "batch", pending: this.pendingContexts.size },
          { agentType: "memory" }
        );
        if (this.pendingContexts.size >= BATCH_QUEUE_MAX_SIZE) {
          logAgentEvent(
            "pre",
            "batch:ready",
            "记忆批处理队列已满",
            { pending: this.pendingContexts.size },
            { agentType: "memory" }
          );
          this.clearBatchIdleTimer();
          void this.processPendingBatch();
        } else {
          this.resetBatchIdleTimer(settings.batchIdleMinutes);
        }
        return;

      case "immediate":
      default:
        this.trackPendingSession(sessionId, workspaceId);
        this.clearDebounceTimer(sessionId);
        logAgentEvent(
          "pre",
          "queued",
          this.processing.has(sessionId) ? "记忆复查已排队" : "记忆任务已排队",
          { session: sessionId, workspace: workspaceId, mode: "immediate" },
          { agentType: "memory" }
        );
        this.enqueueProcess(sessionId, workspaceId);
        return;
    }
  }

  scheduleProcessing(
    sessionId: string,
    workspaceId = "default"
  ): void {
    const settings = getMemorySettingsSync();

    if (!settings.enabled) {
      this.clearSessionWorkForDisabledMemory(sessionId, workspaceId);
      return;
    }

    if (settings.mode === "manual" || settings.mode === "batch") {
      return;
    }

    this.trackPendingSession(sessionId, workspaceId);
    const hadExistingTimer = this.debounceTimers.has(sessionId);
    this.clearDebounceTimer(sessionId);
    logAgentEvent(
      "pre",
      "queued",
      hadExistingTimer ? "记忆任务已重新排队" : "记忆任务已排队",
      {
        session: sessionId,
        workspace: workspaceId,
        delay: `${Math.floor(MEMORY_PROCESS_DEBOUNCE_MS / 1000)}s`,
      },
      { agentType: "memory", verbose: true }
    );

    const timer = setTimeout(() => {
      this.debounceTimers.delete(sessionId);

      if (isAgentRunningForSession(sessionId)) {
        logAgentEvent(
          "pre",
          "delay",
          "会话仍在运行，延后记忆任务",
          { session: sessionId, workspace: workspaceId },
          { agentType: "memory", verbose: true }
        );
        this.scheduleProcessing(sessionId, workspaceId);
        return;
      }

      logAgentEvent(
        "pre",
        "queued",
        "记忆任务延迟窗口结束",
        { session: sessionId, workspace: workspaceId },
        { agentType: "memory", verbose: true }
      );
      this.enqueueProcess(sessionId, workspaceId);
    }, MEMORY_PROCESS_DEBOUNCE_MS);

    this.debounceTimers.set(sessionId, timer);
  }

  async flushAll(): Promise<void> {
    const settings = await loadMemorySettings();

    if (!settings.enabled) {
      this.clearAllWorkForDisabledMemory();
      return;
    }

    if (settings.mode === "manual") {
      logAgentEvent(
        "pre",
        "skip",
        "记忆 flush 跳过",
        { reason: "manual_mode" },
        { agentType: "memory", verbose: true }
      );
      return;
    }

    this.clearBatchIdleTimer();
    this.clearAllDebounceTimers();

    const pendingCount = this.pendingContexts.size;
    if (pendingCount === 0) {
      logAgentEvent(
        "pre",
        "skip",
        "记忆 flush 跳过",
        { reason: "no_pending_sessions" },
        { agentType: "memory", verbose: true }
      );
      return;
    }

    logAgentEvent(
      "pre",
      "flush",
      "开始处理待执行记忆任务",
      { pending: pendingCount },
      { agentType: "memory" }
    );

    if (settings.mode === "batch") {
      await this.processPendingBatch();
      await this.queue;
      return;
    }

    for (const [sessionId, context] of this.pendingContexts) {
      if (this.processing.has(sessionId)) {
        logAgentEvent(
          "pre",
          "skip",
          "记忆任务跳过",
          { session: sessionId, reason: "already_processing" },
          { agentType: "memory", verbose: true }
        );
        continue;
      }
      this.enqueueProcess(sessionId, context.workspaceId);
    }

    await this.queue;
  }

  async processNow(): Promise<{ total: number; processed: number }> {
    this.clearBatchIdleTimer();

    this.clearAllDebounceTimers();

    const settings = await loadMemorySettings();
    if (!settings.enabled) {
      const total = this.clearAllWorkForDisabledMemory();
      logAgentEvent(
        "pre",
        "skip",
        "手动记忆处理跳过",
        { reason: MEMORY_DISABLED_REASON },
        { agentType: "memory" }
      );
      return { total, processed: 0 };
    }

    const total = this.pendingContexts.size;
    if (total === 0) {
      logAgentEvent(
        "pre",
        "skip",
        "手动记忆处理跳过",
        { reason: "no_pending_sessions" },
        { agentType: "memory" }
      );
      this.notifyPendingChanged();
      return { total: 0, processed: 0 };
    }

    logAgentEvent(
      "pre",
      "manual",
      "手动触发记忆处理",
      { pending: total },
      { agentType: "memory" }
    );
    const processed = await this.processPendingBatch();
    this.notifyPendingChanged();

    return { total, processed };
  }

  private clearSessionWorkForDisabledMemory(
    sessionId: string,
    workspaceId: string
  ): void {
    this.clearDebounceTimer(sessionId);
    this.deletePendingContext(sessionId);
    logAgentEvent(
      "pre",
      "skip",
      "记忆任务跳过",
      { session: sessionId, workspace: workspaceId, reason: MEMORY_DISABLED_REASON },
      { agentType: "memory", verbose: true }
    );
  }

  private clearAllWorkForDisabledMemory(): number {
    const pending = this.pendingContexts.size;
    this.clearPending(MEMORY_DISABLED_REASON);
    return pending;
  }

  handleMemoryDisabled(): void {
    this.clearAllWorkForDisabledMemory();
  }

  private clearPending(reason = "cleared"): void {
    const pending = this.pendingContexts.size;
    this.clearBatchIdleTimer();
    this.clearAllDebounceTimers();
    this.pendingContexts.clear();
    if (pending > 0) {
      this.notifyPendingChanged();
    }
    logAgentEvent(
      "pre",
      "clear",
      "记忆待处理队列已清空",
      { pending, reason },
      { agentType: "memory", verbose: true }
    );
  }

  setPendingChangeCallback(callback: (count: number) => void): void {
    this.pendingChangeCallback = callback;
  }

  getPendingCount(): number {
    return this.pendingContexts.size;
  }

  getStatus(): { pending: number; processing: number } {
    return {
      pending: this.pendingContexts.size,
      processing: this.processing.size,
    };
  }

  private clearDebounceTimer(sessionId: string) {
    const timer = this.debounceTimers.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.debounceTimers.delete(sessionId);
  }

  private clearAllDebounceTimers(): void {
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private trackPendingSession(
    sessionId: string,
    workspaceId: string
  ): void {
    this.setPendingContext(sessionId, {
      workspaceId,
      enqueuedAt: Date.now(),
    });
  }

  private setPendingContext(sessionId: string, context: PendingSessionContext): void {
    const previousCount = this.pendingContexts.size;
    this.pendingContexts.set(sessionId, context);
    if (this.pendingContexts.size !== previousCount) {
      this.notifyPendingChanged();
    }
  }

  private deletePendingContext(sessionId: string): void {
    const deleted = this.pendingContexts.delete(sessionId);
    if (deleted) {
      this.notifyPendingChanged();
    }
  }

  private notifyPendingChanged(): void {
    this.pendingChangeCallback?.(this.pendingContexts.size);
  }

  private resetBatchIdleTimer(idleMinutes: number): void {
    this.clearBatchIdleTimer();
    logAgentEvent(
      "pre",
      "batch:timer",
      "记忆批处理等待窗口已设置",
      { idleMinutes },
      { agentType: "memory", verbose: true }
    );
    this.batchIdleTimer = setTimeout(() => {
      this.batchIdleTimer = null;
      logAgentEvent(
        "pre",
        "batch:ready",
        "记忆批处理等待窗口结束",
        { idleMinutes, pending: this.pendingContexts.size },
        { agentType: "memory" }
      );
      void this.processPendingBatch();
    }, idleMinutes * 60 * 1000);
  }

  private clearBatchIdleTimer(): void {
    if (this.batchIdleTimer) {
      clearTimeout(this.batchIdleTimer);
      this.batchIdleTimer = null;
    }
  }

  private getEligiblePendingSessions(): PendingSessionItem[] {
    const pending: PendingSessionItem[] = [];

    for (const [sessionId, context] of this.pendingContexts) {
      if (this.processing.has(sessionId)) {
        continue;
      }
      if (sessionId.startsWith("__memory_")) {
        continue;
      }
      pending.push({ sessionId, context });
    }

    return pending;
  }

  private async processPendingBatch(): Promise<number> {
    const settings = await loadMemorySettings();
    if (!settings.enabled) {
      this.clearAllWorkForDisabledMemory();
      logAgentEvent(
        "pre",
        "skip",
        "记忆批处理跳过",
        { reason: MEMORY_DISABLED_REASON },
        { agentType: "memory", verbose: true }
      );
      return 0;
    }

    const pending = this.getEligiblePendingSessions();

    if (pending.length === 0) {
      logAgentEvent(
        "pre",
        "skip",
        "记忆批处理跳过",
        { reason: "no_eligible_sessions" },
        { agentType: "memory", verbose: true }
      );
      return 0;
    }

    if (pending.length === 1) {
      const { sessionId, context } = pending[0];
      logAgentEvent(
        "pre",
        "batch:single",
        "记忆批处理转为单会话处理",
        { session: sessionId, workspace: context.workspaceId },
        { agentType: "memory", verbose: true }
      );
      return (await this.process(sessionId, context.workspaceId)) ? 1 : 0;
    }

    const byWorkspace = new Map<string, PendingSessionItem[]>();
    for (const item of pending) {
      const group = byWorkspace.get(item.context.workspaceId);
      if (group) {
        group.push(item);
      } else {
        byWorkspace.set(item.context.workspaceId, [item]);
      }
    }

    let totalProcessed = 0;

    for (const group of byWorkspace.values()) {
      const workspaceId = group[0].context.workspaceId;
      logAgentEvent(
        "pre",
        "batch:start",
        "记忆批处理开始",
        { workspace: workspaceId, sessions: group.length },
        { agentType: "memory" }
      );

      const entries: Array<{
        sessionId: string;
        entry: BatchConversationEntry;
      }> = [];

      const allSessions = await listSessions(workspaceId);

      for (const { sessionId, context } of group) {
        try {
          const messages = await loadMessages(sessionId, context.workspaceId);

          if (messages.length < 4) {
            logAgentEvent(
              "pre",
              "skip",
              "记忆任务跳过",
              { session: sessionId, workspace: context.workspaceId, reason: "below_threshold", messages: messages.length },
              { agentType: "memory", verbose: true }
            );
            this.deletePendingContext(sessionId);
            continue;
          }

          const lastProcessed = this.processedMessageCounts.get(sessionId);
          if (lastProcessed !== undefined && lastProcessed >= messages.length) {
            logAgentEvent(
              "pre",
              "skip",
              "记忆任务跳过",
              { session: sessionId, workspace: context.workspaceId, reason: "unchanged", messages: messages.length },
              { agentType: "memory", verbose: true }
            );
            this.deletePendingContext(sessionId);
            continue;
          }

          const sessionTitle =
            allSessions.find((session) => session.id === sessionId)?.title ?? "Untitled Session";

          const conversationTime = context.enqueuedAt
            ? new Date(context.enqueuedAt)
            : new Date();

          entries.push({
            sessionId,
            entry: { sessionTitle, messages, conversationTime },
          });
        } catch (error) {
          logAgentEvent(
            "post",
            "error",
            "记忆批处理读取会话失败",
            { session: sessionId, workspace: context.workspaceId, reason: getErrorMessage(error) },
            { agentType: "memory", level: "error" }
          );
          this.deletePendingContext(sessionId);
        }
      }

      if (entries.length === 0) {
        logAgentEvent(
          "pre",
          "skip",
          "记忆批处理跳过",
          { workspace: workspaceId, reason: "empty_after_filter" },
          { agentType: "memory", verbose: true }
        );
        continue;
      }

      if (entries.length === 1) {
        const { sessionId } = entries[0];
        const ctx = group.find((item) => item.sessionId === sessionId)?.context;
        if (!ctx) {
          continue;
        }
        logAgentEvent(
          "pre",
          "batch:single",
          "记忆批处理转为单会话处理",
          { session: sessionId, workspace: ctx.workspaceId },
          { agentType: "memory", verbose: true }
        );
        if (await this.process(sessionId, ctx.workspaceId)) {
          totalProcessed += 1;
        }
        continue;
      }

      const batchSessionIds = entries.map((item) => item.sessionId);
      for (const sid of batchSessionIds) {
        this.processing.add(sid);
      }

      const startedAt = Date.now();
      const memorySessionId = `__memory_batch_${Date.now()}__`;
      let loopStatus: "success" | "error" = "success";
      let processedCount = 0;
      logAgentLoopStart("MemoryAgent", {
        session: memorySessionId,
        workspace: workspaceId,
        source: "memory",
      });

      try {
        const [memoryContent, userContent] = await Promise.all([
          loadFile("MEMORY.md"),
          loadFile("USER.md"),
        ]);
        logAgentEvent(
          "pre",
          "memory:load",
          "记忆文件已加载",
          {
            memoryChars: memoryContent?.length ?? 0,
            userChars: userContent?.length ?? 0,
          }
        );

        const {
          prompt,
          totalTranscriptMessages,
          keptTranscriptMessages,
          omittedTranscriptMessages,
        } = buildBatchMemoryPrompt(entries.map((item) => item.entry), memoryContent, userContent);

        logAgentEvent(
          "pre",
          "prompt",
          "记忆提示词已生成",
          {
            sessions: entries.length,
            transcript: `${keptTranscriptMessages}/${totalTranscriptMessages}`,
            omitted: omittedTranscriptMessages,
            promptChars: prompt.length,
          }
        );

        const harness = prepareMemoryHarness(memorySessionId, workspaceId, prompt);
        const profile = await buildMemoryProfile({
          sdkRuntime: getSDKRuntimeOptions(),
          harness,
        });
        logAgentEvent(
          "pre",
          "ready",
          "记忆运行参数已准备",
          {
            cwd: profile.options.cwd,
            maxTurns: profile.options.maxTurns,
            promptChars: profile.prompt.length,
          }
        );

        await runAgentWithProfile(
          memorySessionId,
          profile,
          () => {},
          undefined,
          workspaceId,
          "memory"
        );

        for (const { sessionId, entry } of entries) {
          this.processedMessageCounts.set(sessionId, entry.messages.length);
        }
        totalProcessed += entries.length;
        processedCount = entries.length;
      } catch (error) {
        loopStatus = "error";
        logAgentEvent(
          "post",
          "error",
          "记忆批处理失败",
          { reason: getErrorMessage(error) },
          { level: "error" }
        );
      } finally {
        for (const sid of batchSessionIds) {
          this.processing.delete(sid);
          this.deletePendingContext(sid);
        }
        logAgentLoopEnd("MemoryAgent", {
          status: loopStatus,
          totalDuration: formatDurationMs(Date.now() - startedAt),
          session: memorySessionId,
          workspace: workspaceId,
          sessions: batchSessionIds.length,
          processed: processedCount,
        });
      }
    }

    return totalProcessed;
  }

  private enqueueProcess(
    sessionId: string,
    workspaceId = "default"
  ) {
    this.trackPendingSession(sessionId, workspaceId);
    this.queue = this.queue
      .then(async () => {
        await this.process(sessionId, workspaceId);
      })
      .catch((error) => {
        logAgentEvent(
          "post",
          "error",
          "记忆队列执行失败",
          { session: sessionId, workspace: workspaceId, reason: getErrorMessage(error) },
          { agentType: "memory", level: "error" }
        );
      });
  }

  private async process(
    sessionId: string,
    workspaceId = "default"
  ): Promise<boolean> {
    if (this.processing.has(sessionId)) {
      logAgentEvent(
        "pre",
        "skip",
        "记忆任务跳过",
        { session: sessionId, workspace: workspaceId, reason: "already_processing" },
        { agentType: "memory", verbose: true }
      );
      return Promise.resolve(false);
    }

    if (sessionId.startsWith("__memory_")) {
      logAgentEvent(
        "pre",
        "skip",
        "记忆任务跳过",
        { session: sessionId, workspace: workspaceId, reason: "nested_memory_session" },
        { agentType: "memory", verbose: true }
      );
      return Promise.resolve(false);
    }

    const settings = await loadMemorySettings();
    if (!settings.enabled) {
      this.clearSessionWorkForDisabledMemory(sessionId, workspaceId);
      return false;
    }

    return (async () => {
      const startedAt = Date.now();
      let loopStatus: "success" | "skipped" | "error" = "success";
      let processed = false;
      let messageCount = 0;
      this.processing.add(sessionId);
      logAgentLoopStart("MemoryAgent", {
        session: sessionId,
        workspace: workspaceId,
        source: "memory",
      });

      try {
        const messages = await loadMessages(sessionId, workspaceId);
        messageCount = messages.length;
        logAgentEvent(
          "pre",
          "load",
          "会话记录已加载",
          { session: sessionId, workspace: workspaceId, messages: messages.length }
        );
        if (messages.length < 4) {
          loopStatus = "skipped";
          logAgentEvent(
            "pre",
            "skip",
            "记忆任务跳过",
            { reason: "below_threshold", messages: messages.length },
            { verbose: true }
          );
          return false;
        }

        const lastProcessedCount = this.processedMessageCounts.get(sessionId);
        if (lastProcessedCount !== undefined && lastProcessedCount >= messages.length) {
          loopStatus = "skipped";
          logAgentEvent(
            "pre",
            "skip",
            "记忆任务跳过",
            { reason: "unchanged", messages: messages.length },
            { verbose: true }
          );
          return false;
        }

        const [sessions, memoryContent, userContent] = await Promise.all([
          listSessions(workspaceId),
          loadFile("MEMORY.md"),
          loadFile("USER.md"),
        ]);
        const sessionTitle =
          sessions.find((session) => session.id === sessionId)?.title ?? "Untitled Session";
        logAgentEvent(
          "pre",
          "memory:load",
          "记忆文件已加载",
          {
            memoryChars: memoryContent?.length ?? 0,
            userChars: userContent?.length ?? 0,
          }
        );
        const {
          prompt,
          totalTranscriptMessages,
          keptTranscriptMessages,
          omittedTranscriptMessages,
        } = buildMemoryPrompt(messages, sessionTitle, memoryContent, userContent);
        if (keptTranscriptMessages === 0) {
          loopStatus = "skipped";
          logAgentEvent(
            "pre",
            "skip",
            "记忆任务跳过",
            { reason: "empty_transcript" },
            { verbose: true }
          );
          return false;
        }

        logAgentEvent(
          "pre",
          "prompt",
          "记忆提示词已生成",
          {
            transcript: `${keptTranscriptMessages}/${totalTranscriptMessages}`,
            omitted: omittedTranscriptMessages,
            promptChars: prompt.length,
            title: truncateText(sessionTitle, 80),
          }
        );
        const memorySessionId = `__memory_${sessionId}__`;

        const harness = prepareMemoryHarness(memorySessionId, workspaceId, prompt);
        const profile = await buildMemoryProfile({
          sdkRuntime: getSDKRuntimeOptions(),
          harness,
        });
        logAgentEvent(
          "pre",
          "ready",
          "记忆运行参数已准备",
          {
            cwd: profile.options.cwd,
            maxTurns: profile.options.maxTurns,
            promptChars: profile.prompt.length,
          }
        );

        await runAgentWithProfile(
          memorySessionId,
          profile,
          () => {},
          undefined,
          workspaceId,
          "memory"
        );
        this.processedMessageCounts.set(sessionId, messages.length);

        processed = true;
        return true;
      } catch (error) {
        loopStatus = "error";
        logAgentEvent(
          "post",
          "error",
          "记忆任务失败",
          {
            session: sessionId,
            workspace: workspaceId,
            reason: getErrorMessage(error),
          },
          { level: "error" }
        );
        return false;
      } finally {
        this.processing.delete(sessionId);
        this.deletePendingContext(sessionId);
        logAgentLoopEnd("MemoryAgent", {
          status: loopStatus,
          totalDuration: formatDurationMs(Date.now() - startedAt),
          session: sessionId,
          workspace: workspaceId,
          messages: messageCount,
          processed,
        });
      }
    })();
  }
}

export const memoryAgent = new MemoryAgent();
