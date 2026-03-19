import type { AgentStreamEvent } from "../../shared/zora";
import type { FeishuGateway } from "./gateway";
import { isRecord } from "../utils/guards";

const STREAM_UPDATE_INTERVAL_MS = 100;
const MAX_CARD_TEXT_LENGTH = 25_000;
const INITIAL_STREAM_BATCH_DELAY_MS = 160;
const INITIAL_STREAM_MIN_CHARS = 12;
const INITIAL_STREAM_MAX_CHARS = 32;
const STREAM_PROGRESS_MIN_CHARS = 24;
const FORCE_STREAM_PREVIEW_IDLE_MS = 220;

type FeishuGatewayLike = Pick<
  FeishuGateway,
  | "addTypingReaction"
  | "createStreamingCard"
  | "finalizeStreamingCard"
  | "removeTypingReaction"
  | "replyMessage"
  | "sendMessage"
  | "streamCardContent"
>;

type StreamState = {
  cardId: string | null;
  messageId: string;
  chatId: string;
  userMessageId: string;
  text: string;
  sequence: number;
  toolCalls: number;
  lastUpdateTime: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  activeFlush: Promise<void> | null;
  needsFlush: boolean;
  isStreamingMode: boolean;
  error: string | null;
  typingReactionId: string | null;
  lastStreamedContent: string;
  seenToolUseIds: Set<string>;
  firstTextDeltaAt: number | null;
  lastTextDeltaAt: number | null;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function extractAssistantSnapshot(message: unknown): {
  text: string;
  toolUseIds: string[];
  toolUseCount: number;
} {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return { text: "", toolUseIds: [], toolUseCount: 0 };
  }

  const textParts: string[] = [];
  const toolUseIds: string[] = [];
  let toolUseCount = 0;

  for (const block of message.content) {
    if (!isRecord(block) || typeof block.type !== "string") {
      continue;
    }

    if (block.type === "text" && isNonEmptyString(block.text)) {
      textParts.push(block.text);
      continue;
    }

    if (block.type === "tool_use") {
      toolUseCount += 1;
      if (isNonEmptyString(block.id)) {
        toolUseIds.push(block.id);
      }
    }
  }

  return {
    text: textParts.join(""),
    toolUseIds,
    toolUseCount,
  };
}

function appendTextDelta(existing: string, delta: string): string {
  if (!delta) {
    return existing;
  }

  return `${existing}${delta}`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimUnmatchedMarker(text: string, marker: string): string {
  const regex = new RegExp(escapeRegex(marker), "g");
  const matches = [...text.matchAll(regex)];
  if (matches.length % 2 === 0) {
    return text;
  }

  const lastIndex = matches.at(-1)?.index ?? -1;
  return lastIndex >= 0 ? text.slice(0, lastIndex) : text;
}

function trimIncompleteMarkdownTail(text: string): string {
  let safe = text;

  const fenceMatches = [...safe.matchAll(/```/g)];
  if (fenceMatches.length % 2 !== 0) {
    const lastFenceIndex = fenceMatches.at(-1)?.index ?? -1;
    if (lastFenceIndex >= 0) {
      safe = safe.slice(0, lastFenceIndex);
    }
  }

  safe = trimUnmatchedMarker(safe, "**");
  safe = trimUnmatchedMarker(safe, "__");
  safe = trimUnmatchedMarker(safe, "`");

  const lastOpenBracket = safe.lastIndexOf("[");
  const lastCloseBracket = safe.lastIndexOf("]");
  if (lastOpenBracket > lastCloseBracket) {
    safe = safe.slice(0, lastOpenBracket);
  }

  const lastLinkOpen = safe.lastIndexOf("](");
  if (lastLinkOpen >= 0 && safe.lastIndexOf(")", safe.length) < lastLinkOpen + 2) {
    safe = safe.slice(0, lastLinkOpen + 1);
  }

  return safe.trimEnd();
}

function findEarliestBreakAfter(text: string, minIndex: number): number {
  if (minIndex >= text.length) {
    return -1;
  }

  const patterns = [
    /\n[\t ]*\n+/g,
    /\n/g,
    /[。！？!?；;:：](?:["'”’）】」》])?(?=\s|$)/g,
    /\s+/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = Math.max(0, minIndex);
    const match = pattern.exec(text);
    if (!match || match.index === undefined) {
      continue;
    }

    return match.index + match[0].length;
  }

  return -1;
}

function getLastStreamedPreview(state: StreamState): string {
  return state.lastStreamedContent === "思考中..." ? "" : state.lastStreamedContent;
}

function buildStreamingPreviewText(state: StreamState): string {
  const raw = state.text.trim();
  if (!raw) {
    return "思考中...";
  }

  const safe = trimIncompleteMarkdownTail(raw) || raw;
  const previousPreview = getLastStreamedPreview(state);
  const previousLength = previousPreview.length;
  const nextBreak = findEarliestBreakAfter(
    safe,
    previousLength === 0 ? INITIAL_STREAM_MIN_CHARS : previousLength + STREAM_PROGRESS_MIN_CHARS
  );

  if (nextBreak > 0) {
    const preview = safe.slice(0, nextBreak).trimEnd();
    if (preview.length >= previousLength) {
      return preview;
    }
  }

  const idleMs =
    state.lastTextDeltaAt === null ? Number.POSITIVE_INFINITY : Date.now() - state.lastTextDeltaAt;

  if (previousLength === 0) {
    if (idleMs >= INITIAL_STREAM_BATCH_DELAY_MS || safe.length <= INITIAL_STREAM_MAX_CHARS) {
      return safe.slice(0, Math.min(safe.length, INITIAL_STREAM_MAX_CHARS)).trimEnd();
    }
    return "思考中...";
  }

  if (idleMs >= FORCE_STREAM_PREVIEW_IDLE_MS && safe.length > previousLength) {
    return safe;
  }

  return previousPreview || "思考中...";
}

function normalizeBodyText(
  text: string,
  error: string | null,
  status: "success" | "error"
): string {
  const trimmedText = text.trim();
  if (trimmedText.length > 0) {
    return trimmedText;
  }

  const trimmedError = error?.trim();
  if (trimmedError) {
    return trimmedError;
  }

  return status === "error" ? "❌ Zora 在处理这条消息时出错了。" : "(无内容)";
}

export class FeishuMessageSender {
  private streamStates = new Map<string, StreamState>();

  constructor(private gateway: FeishuGatewayLike) {}

  async onAgentStart(chatId: string, userMessageId: string, sessionId: string): Promise<void> {
    const [typingReactionId, streamHandle] = await Promise.all([
      this.gateway.addTypingReaction(userMessageId),
      this.gateway.createStreamingCard(chatId, userMessageId),
    ]);

    this.streamStates.set(sessionId, {
      cardId: streamHandle?.cardId ?? null,
      messageId: streamHandle?.messageId ?? "",
      chatId,
      userMessageId,
      text: "",
      sequence: streamHandle?.sequence ?? 0,
      toolCalls: 0,
      lastUpdateTime: 0,
      flushTimer: null,
      activeFlush: null,
      needsFlush: false,
      isStreamingMode: streamHandle !== null,
      error: null,
      typingReactionId,
      lastStreamedContent: "思考中...",
      seenToolUseIds: new Set<string>(),
      firstTextDeltaAt: null,
      lastTextDeltaAt: null,
    });
  }

  handleAgentEvent(sessionId: string, event: AgentStreamEvent): void {
    const state = this.streamStates.get(sessionId);
    if (!state || !isRecord(event) || typeof event.type !== "string") {
      return;
    }

    if (event.type === "agent_error" && isNonEmptyString(event.error)) {
      state.error = event.error;
      return;
    }

    if (event.type === "stream_event" && isRecord(event.event) && typeof event.event.type === "string") {
      const streamEvent = event.event;

      if (
        streamEvent.type === "content_block_delta" &&
        isRecord(streamEvent.delta) &&
        streamEvent.delta.type === "text_delta" &&
        isNonEmptyString(streamEvent.delta.text)
      ) {
        const now = Date.now();
        state.text = appendTextDelta(state.text, streamEvent.delta.text);
        state.firstTextDeltaAt ??= now;
        state.lastTextDeltaAt = now;
        this.requestStreamFlush(sessionId, state);
        return;
      }

      if (
        streamEvent.type === "content_block_start" &&
        isRecord(streamEvent.content_block) &&
        streamEvent.content_block.type === "tool_use"
      ) {
        this.trackToolUse(state, streamEvent.content_block.id);
      }

      return;
    }

    if (event.type !== "assistant" || !isRecord(event.message)) {
      return;
    }

    const snapshot = extractAssistantSnapshot(event.message);
    if (state.firstTextDeltaAt === null && snapshot.text.trim().length > 0) {
      state.text = snapshot.text;
      this.requestStreamFlush(sessionId, state);
    }

    for (const toolUseId of snapshot.toolUseIds) {
      this.trackToolUse(state, toolUseId);
    }

    state.toolCalls = Math.max(state.toolCalls, snapshot.toolUseCount);
  }

  markError(sessionId: string, errorText: string): void {
    const state = this.streamStates.get(sessionId);
    if (!state) {
      return;
    }

    state.error = errorText;
  }

  async onAgentEnd(sessionId: string, status: "success" | "error"): Promise<void> {
    const state = this.streamStates.get(sessionId);
    if (!state) {
      return;
    }

    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }

    try {
      if (state.activeFlush) {
        await state.activeFlush.catch(() => undefined);
      }

      if (state.isStreamingMode && state.cardId) {
        await this.flushStreamUpdate(sessionId, state);
      }

      const bodyText = normalizeBodyText(state.text, state.error, status);
      const chunks = this.splitText(bodyText, MAX_CARD_TEXT_LENGTH);

      if (state.cardId) {
        state.sequence = await this.gateway.finalizeStreamingCard(
          state.cardId,
          this.buildFinalCard(chunks[0] ?? bodyText, state.toolCalls, status),
          state.sequence
        );

        for (const extraChunk of chunks.slice(1)) {
          await this.gateway.sendMessage(
            state.chatId,
            "interactive",
            JSON.stringify(this.buildFinalCard(extraChunk, state.toolCalls, status))
          );
        }
        return;
      }

      if (chunks.length <= 1) {
        await this.gateway.replyMessage(
          state.userMessageId,
          "interactive",
          JSON.stringify(this.buildFinalCard(bodyText, state.toolCalls, status))
        );
        return;
      }

      for (const chunk of chunks) {
        await this.gateway.sendMessage(
          state.chatId,
          "interactive",
          JSON.stringify(this.buildFinalCard(chunk, state.toolCalls, status))
        );
      }
    } catch (error) {
      console.error("[Feishu Sender] Final send error:", error);

      try {
        await this.gateway.sendMessage(
          state.chatId,
          "text",
          JSON.stringify({
            text: normalizeBodyText(state.text, state.error, status),
          })
        );
      } catch (fallbackError) {
        console.error("[Feishu Sender] Fallback text send failed:", fallbackError);
      }
    } finally {
      await this.gateway
        .removeTypingReaction(state.userMessageId, state.typingReactionId)
        .catch(() => undefined);
      this.streamStates.delete(sessionId);
    }
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.gateway.sendMessage(
      chatId,
      "interactive",
      JSON.stringify(this.buildFinalCard(text, 0, "success"))
    );
  }

  private trackToolUse(state: StreamState, toolUseId: unknown): void {
    if (isNonEmptyString(toolUseId)) {
      if (state.seenToolUseIds.has(toolUseId)) {
        return;
      }

      state.seenToolUseIds.add(toolUseId);
    }

    state.toolCalls += 1;
  }

  private requestStreamFlush(sessionId: string, state: StreamState): void {
    if (!state.isStreamingMode || !state.cardId) {
      return;
    }

    if (state.activeFlush) {
      state.needsFlush = true;
      return;
    }

    if (state.lastUpdateTime === 0 && state.firstTextDeltaAt !== null) {
      const elapsedSinceFirstText = Date.now() - state.firstTextDeltaAt;
      if (
        state.text.length < INITIAL_STREAM_MIN_CHARS &&
        elapsedSinceFirstText < INITIAL_STREAM_BATCH_DELAY_MS
      ) {
        if (!state.flushTimer) {
          state.flushTimer = setTimeout(() => {
            state.flushTimer = null;
            void this.flushStreamUpdate(sessionId, state);
          }, INITIAL_STREAM_BATCH_DELAY_MS - elapsedSinceFirstText);
          state.flushTimer.unref?.();
        }
        return;
      }
    }

    const elapsed = Date.now() - state.lastUpdateTime;
    if (elapsed >= STREAM_UPDATE_INTERVAL_MS) {
      void this.flushStreamUpdate(sessionId, state);
      return;
    }

    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
    }

    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      void this.flushStreamUpdate(sessionId, state);
    }, STREAM_UPDATE_INTERVAL_MS - elapsed);
    state.flushTimer.unref?.();
  }

  private async flushStreamUpdate(sessionId: string, state: StreamState): Promise<void> {
    if (!state.isStreamingMode || !state.cardId) {
      return;
    }

    const content = this.buildStreamingContent(state);
    if (content === state.lastStreamedContent && state.lastUpdateTime > 0) {
      return;
    }

    if (state.activeFlush) {
      state.needsFlush = true;
      return state.activeFlush;
    }

    const task = (async () => {
      const current = this.streamStates.get(sessionId);
      if (current !== state || !state.cardId || !state.isStreamingMode) {
        return;
      }

      state.lastUpdateTime = Date.now();
      const nextSequence = state.sequence + 1;
      const success = await this.gateway.streamCardContent(state.cardId, content, nextSequence);
      if (!success) {
        state.isStreamingMode = false;
        console.warn("[Feishu Sender] Stream update failed, falling back to final batch mode.");
        return;
      }

      state.sequence = nextSequence;
      state.lastStreamedContent = content;
    })();

    state.activeFlush = task.finally(() => {
      if (state.activeFlush === task) {
        state.activeFlush = null;
      }

      if (state.needsFlush && state.isStreamingMode && state.cardId) {
        state.needsFlush = false;
        this.requestStreamFlush(sessionId, state);
      }
    });

    return state.activeFlush;
  }

  private buildStreamingContent(state: StreamState): string {
    return buildStreamingPreviewText(state);
  }

  private buildFinalCard(
    text: string,
    toolCalls: number,
    status: "success" | "error"
  ): object {
    const elements: object[] = [
      {
        tag: "markdown",
        content: text || "(无内容)",
      },
    ];

    if (toolCalls > 0) {
      elements.push({ tag: "hr" });
      elements.push({
        tag: "markdown",
        content: `🔧 ${toolCalls} tool calls`,
        text_size: "notation",
      });
    }

    return {
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "✨ Zora" },
        template: status === "error" ? "red" : "indigo",
      },
      body: { elements },
    };
  }

  private splitText(text: string, maxLen: number): string[] {
    const chunks: string[] = [];
    let remaining = text.trim();

    while (remaining.length > maxLen) {
      let splitAt = remaining.lastIndexOf("\n\n", maxLen);
      if (splitAt <= 0) {
        splitAt = remaining.lastIndexOf("\n", maxLen);
      }
      if (splitAt <= 0) {
        splitAt = maxLen;
      }

      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks.length > 0 ? chunks : [text];
  }
}
