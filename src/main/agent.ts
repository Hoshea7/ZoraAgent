import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import type {
  AgentRunInfo,
  AgentRunSource,
  AgentStatus,
  AgentStreamEvent,
  FileAttachment,
} from "../shared/zora";
import {
  formatAgentName,
  formatCostUsd,
  formatDurationMs,
  isAgentLoopActiveFor,
  isVerboseAgentLoopLog,
  logAgentEvent,
  logAgentLoopEnd,
  logAgentLoopStart,
  truncateLogText,
} from "./agent-loop-log";
import {
  attachmentsToContentBlocks,
  buildMultimodalPrompt,
  type AttachmentProjectionOptions,
} from "./attachment-handler";
import { clearAllPending } from "./hitl";
import { ensureZoraDir } from "./memory-store";
import type { QueryProfile } from "./query-profiles/types";
export { resolveSDKCliPath } from "./sdk-runtime";
import { setSdkSessionId } from "./session-store";

type JsonRecord = Record<string, unknown>;
type SdkMessageUuid = NonNullable<SDKUserMessage["uuid"]>;
export type AgentEventForwarder = (event: AgentStreamEvent) => void;

export interface QueuedAgentMessage {
  uuid: string;
  text: string;
  attachments?: FileAttachment[];
}

export interface AgentRunResult {
  lateQueuedMessages: QueuedAgentMessage[];
  sdkSessionId?: string;
}

export class MissingSdkSessionError extends Error {
  readonly sdkSessionId?: string;

  constructor(message: string, sdkSessionId?: string) {
    super(message);
    this.name = "MissingSdkSessionError";
    this.sdkSessionId = sdkSessionId;
  }
}

type ActiveAgentRun = {
  query: {
    interrupt: () => Promise<void>;
    close: () => void;
  };
  stopping: boolean;
  source: AgentRunSource;
  profileName: QueryProfile["name"];
  attachmentProjection: AttachmentProjectionOptions;
};

const activeAgentRuns = new Map<string, ActiveAgentRun>();

/** 活跃的 SDK Query 对象映射，供生命周期检查使用 */
const activeQueries = new Map<string, any>();

/** 活跃的 SDK 输入流，保持 stdin 打开以支持权限控制请求和追加消息 */
const activeInputStreams = new Map<string, AgentInputStream>();

/** Query 就绪同步屏障 —— 在 SDK query 对象创建前缓冲队列消息 */
const queryReadyPromises = new Map<string, Promise<void>>();
const queryReadyResolvers = new Map<string, () => void>();

/** 队列消息 UUID 集合（防重） */
const queuedMessageUuids = new Map<string, Set<string>>();

/** 尚未收到 SDK replay ack 的队列消息 UUID */
const pendingQueuedMessageUuids = new Map<string, Set<string>>();

/** 队列消息正文，用于 result 到达前仍未被 SDK replay 的 late queue 补跑 */
const queuedMessagePayloads = new Map<string, Map<string, QueuedAgentMessage>>();

/** 就绪等待超时 */
const QUERY_READY_TIMEOUT_MS = 30_000;

class AgentInputStream implements AsyncIterable<SDKUserMessage>, AsyncIterator<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private pendingResolve:
    | ((result: IteratorResult<SDKUserMessage>) => void)
    | undefined;
  private pendingReject: ((reason?: unknown) => void) | undefined;
  private closed = false;
  private errorValue: unknown;
  private started = false;

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    if (this.started) {
      throw new Error("Agent input stream can only be iterated once");
    }
    this.started = true;
    return this;
  }

  next(): Promise<IteratorResult<SDKUserMessage>> {
    if (this.queue.length > 0) {
      return Promise.resolve({
        done: false,
        value: this.queue.shift() as SDKUserMessage,
      });
    }

    if (this.errorValue) {
      return Promise.reject(this.errorValue);
    }

    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }

    return new Promise<IteratorResult<SDKUserMessage>>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  enqueue(message: SDKUserMessage): void {
    if (this.closed) {
      throw new Error("输入流已关闭");
    }

    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = undefined;
      this.pendingReject = undefined;
      resolve({ done: false, value: message });
      return;
    }

    this.queue.push(message);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = undefined;
      this.pendingReject = undefined;
      resolve({ done: true, value: undefined });
    }
  }

  fail(error: unknown): void {
    this.errorValue = error;
    if (this.pendingReject) {
      const reject = this.pendingReject;
      this.pendingResolve = undefined;
      this.pendingReject = undefined;
      reject(error);
    }
  }

  return(): Promise<IteratorResult<SDKUserMessage>> {
    this.close();
    return Promise.resolve({ done: true, value: undefined });
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeSdkModelEnv(env: Record<string, string> | undefined): Record<string, unknown> | null {
  if (!env) {
    return null;
  }

  return {
    baseUrl: env.ANTHROPIC_BASE_URL ?? "(official anthropic)",
    mainModel: env.ANTHROPIC_MODEL ?? "(sdk default)",
    smallFastModel: env.ANTHROPIC_SMALL_FAST_MODEL ?? "(sdk default)",
    sonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "(sdk default)",
    opusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? "(sdk default)",
    haikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "(sdk default)",
    disableExperimentalBetas: env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS === "1",
    clientApp: env.CLAUDE_AGENT_SDK_CLIENT_APP ?? "(unset)",
  };
}

function countRecordItems(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (isRecord(value)) {
    return Object.keys(value).length;
  }

  return undefined;
}

function listRecordNames(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (isRecord(item) && typeof item.name === "string") {
          return item.name;
        }

        return "";
      })
      .filter(Boolean);
  }

  if (isRecord(value)) {
    return Object.keys(value);
  }

  return undefined;
}

function summarizeQueryOptions(options: QueryProfile["options"]): Record<string, unknown> {
  const rawOptions = options as Record<string, unknown>;
  const env = isRecord(rawOptions.env) ? rawOptions.env as Record<string, string> : undefined;
  const systemPrompt = rawOptions.systemPrompt;

  return {
    cwd: typeof rawOptions.cwd === "string" ? rawOptions.cwd : undefined,
    permissionMode: typeof rawOptions.permissionMode === "string" ? rawOptions.permissionMode : undefined,
    maxTurns: typeof rawOptions.maxTurns === "number" ? rawOptions.maxTurns : undefined,
    persistSession: rawOptions.persistSession,
    includePartialMessages: rawOptions.includePartialMessages,
    strictMcpConfig: rawOptions.strictMcpConfig,
    resume: typeof rawOptions.resume === "string" ? rawOptions.resume : undefined,
    executable: rawOptions.executable,
    executableArgs: Array.isArray(rawOptions.executableArgs) ? rawOptions.executableArgs : undefined,
    modelEnv: summarizeSdkModelEnv(env),
    mcpServers: listRecordNames(rawOptions.mcpServers),
    plugins: Array.isArray(rawOptions.plugins)
      ? rawOptions.plugins.map((item) =>
          isRecord(item) && typeof item.path === "string" ? item.path : stringifyContent(item)
        )
      : undefined,
    hasCanUseTool: typeof rawOptions.canUseTool === "function",
    systemPrompt:
      typeof systemPrompt === "string"
        ? { type: "string", chars: systemPrompt.length }
        : isRecord(systemPrompt)
          ? { type: systemPrompt.type, preset: systemPrompt.preset, appendChars: typeof systemPrompt.append === "string" ? systemPrompt.append.length : undefined }
          : undefined,
    extraArgs: isRecord(rawOptions.extraArgs) ? rawOptions.extraArgs : undefined,
  };
}

function summarizePreparedOptions(options: QueryProfile["options"]): Record<string, unknown> {
  const rawOptions = options as Record<string, unknown>;
  return {
    permissionMode: typeof rawOptions.permissionMode === "string" ? rawOptions.permissionMode : undefined,
    maxTurns: typeof rawOptions.maxTurns === "number" ? rawOptions.maxTurns : undefined,
    mcpServers: countRecordItems(rawOptions.mcpServers),
    includePartialMessages: rawOptions.includePartialMessages,
    persistSession: rawOptions.persistSession,
    strictMcpConfig: rawOptions.strictMcpConfig,
  };
}

function summarizeToolInput(toolName: string, input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    return { input: truncateLogText(stringifyContent(input), 240) };
  }

  if (toolName === "Bash" && typeof input.command === "string") {
    return { command: input.command };
  }

  const filePath =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : undefined;
  if (filePath) {
    return {
      file: filePath,
      action:
        typeof input.action === "string"
          ? input.action
          : typeof input.command === "string"
            ? input.command
            : undefined,
    };
  }

  if (typeof input.pattern === "string") {
    return {
      pattern: input.pattern,
      path: typeof input.path === "string" ? input.path : undefined,
    };
  }

  if (typeof input.url === "string") {
    return { url: input.url };
  }

  return {
    inputKeys: Object.keys(input),
    inputPreview: truncateLogText(stringifyContent(input), 240),
  };
}

function extractTextFromToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!isRecord(item)) {
          return stringifyContent(item);
        }

        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }

        return stringifyContent(item);
      })
      .filter(Boolean)
      .join("\n");
  }

  return stringifyContent(content);
}

function formatCacheHit(usage: unknown): string | undefined {
  if (!isRecord(usage)) {
    return undefined;
  }

  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const cacheRead =
    typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
  const cacheCreate =
    typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0;
  const total = input + cacheRead + cacheCreate;

  if (total <= 0) {
    return undefined;
  }

  return `${((cacheRead / total) * 100).toFixed(1)}%`;
}

function summarizeSdkUsage(usage: unknown): Record<string, unknown> {
  if (!isRecord(usage)) {
    return {};
  }

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheCreateTokens: usage.cache_creation_input_tokens,
    cacheHit: formatCacheHit(usage),
  };
}

function hasLogFields(fields: Record<string, unknown>): boolean {
  return Object.values(fields).some((value) => value !== undefined);
}

function extractAssistantContent(message: unknown): string {
  if (!isRecord(message)) {
    return stringifyContent(message);
  }

  const content = message.content;
  if (!Array.isArray(content)) {
    return stringifyContent(message);
  }

  return content
    .map((block) => {
      if (!isRecord(block)) {
        return stringifyContent(block);
      }

      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }

      return stringifyContent(block);
    })
    .filter(Boolean)
    .join("\n");
}

function emitAgentStatus(
  status: AgentStatus,
  onEvent?: AgentEventForwarder,
  source?: AgentRunSource
) {
  onEvent?.({
    type: "agent_status",
    status,
    source,
  });
}

function emitAgentError(
  error: unknown,
  onEvent?: AgentEventForwarder,
  profileName?: QueryProfile["name"]
) {
  const payload = {
    type: "agent_error",
    error: error instanceof Error ? error.message : stringifyContent(error)
  } as const;

  logAgentEvent(
    "runtime",
    "sdk:error",
    "SDK 返回错误",
    {
      profile: profileName,
      reason: payload.error,
    },
    { level: "error" }
  );
  onEvent?.(payload);
}

class SdkMessageConsoleLogger {
  private readonly completedThinkingIndexes = new Set<number>();
  private readonly loggedThinkingContentIndexes = new Set<number>();
  private readonly thinkingByIndex = new Map<number, { content: string; startedAt: number }>();
  private readonly toolNamesById = new Map<string, string>();
  private readonly loggedToolUseIds = new Set<string>();
  private hasCurrentStreamedAssistantMessage = false;

  constructor(private readonly onEvent?: AgentEventForwarder) {}

  log(message: SDKMessage): void {
    switch (message.type) {
      case "stream_event":
        this.onEvent?.(message);
        this.logStreamEvent(message);
        return;
      case "assistant":
        this.onEvent?.(message);
        this.logAssistantMessage(message);
        return;
      case "user":
        this.onEvent?.(message);
        this.logUserMessage(message);
        return;
      case "system":
        this.onEvent?.(message);
        this.logSystemMessage(message);
        return;
      case "result":
        this.onEvent?.(message);
        this.logResultMessage(message);
        return;
      case "auth_status":
        this.logAuthStatus(message);
        return;
      case "tool_progress":
        logAgentEvent(
          "runtime",
          "tool:progress",
          "工具进度",
          {
            tool: message.tool_name,
            toolUseId: message.tool_use_id,
            elapsed: `${message.elapsed_time_seconds}s`,
          },
          { verbose: true }
        );
        return;
      case "tool_use_summary":
        logAgentEvent(
          "runtime",
          "tool:summary",
          "工具摘要",
          {
            summary: message.summary,
            toolUseIds: message.preceding_tool_use_ids,
          },
          { verbose: true }
        );
        return;
      case "rate_limit_event":
        logAgentEvent("runtime", "sdk:rate-limit", "SDK 限流状态", {
          status: isRecord(message.rate_limit_info) ? message.rate_limit_info.status : undefined,
          rateLimitType: isRecord(message.rate_limit_info)
            ? message.rate_limit_info.rateLimitType
            : undefined,
        });
        return;
      default:
        logAgentEvent(
          "runtime",
          "sdk:message",
          "SDK 消息",
          {
            type: message.type,
            detail: truncateLogText(stringifyContent(message), 500),
          },
          { verbose: true }
        );
    }
  }

  private logStreamEvent(message: Extract<SDKMessage, { type: "stream_event" }>): void {
    const event = message.event;
    if (!isRecord(event) || typeof event.type !== "string") {
      return;
    }

    if (event.type === "content_block_start") {
      if (event.index === 0) {
        this.resetMessageScopedThinkingState();
        this.hasCurrentStreamedAssistantMessage = true;
      }
      this.logContentBlockStart(event);
      return;
    }

    if (event.type === "content_block_delta") {
      this.collectContentBlockDelta(event);
      return;
    }

    if (event.type === "content_block_stop") {
      this.logContentBlockStop(event);
    }
  }

  private logContentBlockStart(event: JsonRecord): void {
    const index = typeof event.index === "number" ? event.index : -1;
    const block = isRecord(event.content_block) ? event.content_block : undefined;
    if (!block || block.type !== "thinking") {
      return;
    }

    this.thinkingByIndex.set(index, {
      content: typeof block.thinking === "string" ? block.thinking : "",
      startedAt: Date.now(),
    });
    logAgentEvent("runtime", "thinking:start", "开始思考");
  }

  private collectContentBlockDelta(event: JsonRecord): void {
    const index = typeof event.index === "number" ? event.index : -1;
    const delta = isRecord(event.delta) ? event.delta : undefined;
    if (!delta || delta.type !== "thinking_delta" || typeof delta.thinking !== "string") {
      return;
    }

    const current = this.thinkingByIndex.get(index) ?? { content: "", startedAt: Date.now() };
    current.content += delta.thinking;
    this.thinkingByIndex.set(index, current);
  }

  private logContentBlockStop(event: JsonRecord): void {
    const index = typeof event.index === "number" ? event.index : -1;
    const thinking = this.thinkingByIndex.get(index);
    if (!thinking) {
      return;
    }

    const duration = Date.now() - thinking.startedAt;
    this.completedThinkingIndexes.add(index);
    this.thinkingByIndex.delete(index);
    logAgentEvent("runtime", "thinking:done", "思考完成", {
      duration: formatDurationMs(duration),
      chars: thinking.content.length,
    });
    if (thinking.content.trim() && !this.loggedThinkingContentIndexes.has(index)) {
      this.loggedThinkingContentIndexes.add(index);
      logAgentEvent(
        "runtime",
        "thinking:content",
        "思考内容",
        {
          chars: thinking.content.length,
          text: thinking.content.trim(),
        },
        { verbose: true }
      );
    }
  }

  private logAssistantMessage(message: Extract<SDKMessage, { type: "assistant" }>): void {
    const hasStreamedThinkingState = this.hasCurrentStreamedAssistantMessage;
    if (!hasStreamedThinkingState) {
      this.resetMessageScopedThinkingState();
    }

    if (message.error) {
      logAgentEvent("runtime", "assistant:error", "回复异常", {
        error: message.error,
      });
    }

    const sdkMessage = message.message;
    if (!isRecord(sdkMessage) || !Array.isArray(sdkMessage.content)) {
      logAgentEvent("runtime", "assistant", "收到回复", {
        text: extractAssistantContent(sdkMessage),
      });
      this.resetMessageScopedThinkingState();
      return;
    }

    sdkMessage.content.forEach((block, index) => {
      if (!isRecord(block)) {
        return;
      }

      if (block.type === "thinking" && typeof block.thinking === "string") {
        if (this.completedThinkingIndexes.has(index)) {
          return;
        }

        if (this.loggedThinkingContentIndexes.has(index)) {
          return;
        }

        this.loggedThinkingContentIndexes.add(index);
        logAgentEvent(
          "runtime",
          "thinking:content",
          "思考内容",
          {
            chars: block.thinking.length,
            text: block.thinking.trim(),
          },
          { verbose: true }
        );
        return;
      }

      if (block.type === "tool_use") {
        const toolUseId = typeof block.id === "string" ? block.id : undefined;
        const toolName = typeof block.name === "string" ? block.name : "unknown";
        if (toolUseId) {
          this.toolNamesById.set(toolUseId, toolName);
          if (this.loggedToolUseIds.has(toolUseId)) {
            return;
          }
          this.loggedToolUseIds.add(toolUseId);
        }

        logAgentEvent("runtime", "tool:call", "调用工具", {
          tool: toolName,
          toolUseId,
          ...summarizeToolInput(toolName, block.input),
        });
        if (isVerboseAgentLoopLog()) {
          logAgentEvent(
            "runtime",
            "tool:input",
            "工具输入",
            {
              tool: toolName,
              toolUseId,
              input: stringifyContent(block.input),
            },
            { verbose: true }
          );
        }
        return;
      }

      if (block.type === "text" && typeof block.text === "string") {
        logAgentEvent("runtime", "assistant", "收到回复", {
          chars: block.text.length,
          text: block.text.trim(),
        });
      }
    });
    this.resetMessageScopedThinkingState();
  }

  private resetMessageScopedThinkingState(): void {
    this.completedThinkingIndexes.clear();
    this.loggedThinkingContentIndexes.clear();
    this.thinkingByIndex.clear();
    this.hasCurrentStreamedAssistantMessage = false;
  }

  private logUserMessage(message: Extract<SDKMessage, { type: "user" }>): void {
    if ("isReplay" in message && message.isReplay === true) {
      logAgentEvent(
        "runtime",
        "queue:received",
        "队列消息已确认",
        { uuid: message.uuid },
        { verbose: true }
      );
    }

    if (message.tool_use_result !== undefined) {
      this.logToolResult(undefined, message.tool_use_result, false);
      return;
    }

    const sdkMessage = message.message;
    if (!isRecord(sdkMessage) || !Array.isArray(sdkMessage.content)) {
      return;
    }

    for (const block of sdkMessage.content) {
      if (!isRecord(block) || block.type !== "tool_result") {
        continue;
      }

      this.logToolResult(
        typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
        block.content,
        block.is_error === true
      );
    }
  }

  private logToolResult(
    toolUseId: string | undefined,
    content: unknown,
    isError: boolean
  ): void {
    const toolName = toolUseId ? this.toolNamesById.get(toolUseId) : undefined;
    const text = extractTextFromToolResultContent(content);
    logAgentEvent("runtime", "tool:result", "工具返回", {
      tool: toolName,
      toolUseId,
      status: isError ? "error" : "success",
      chars: text.length,
      preview: truncateLogText(text.trim(), 220),
    });
    if (isVerboseAgentLoopLog()) {
      logAgentEvent(
        "runtime",
        "tool:result:detail",
        "工具返回详情",
        {
          tool: toolName,
          toolUseId,
          content: text,
        },
        { verbose: true }
      );
    }
  }

  private logSystemMessage(message: Extract<SDKMessage, { type: "system" }>): void {
    const subtype = typeof message.subtype === "string" ? message.subtype : "unknown";

    if (subtype === "init") {
      logAgentEvent("runtime", "sdk:init", "SDK 初始化完成", {
        sdkSessionId: "session_id" in message ? stringifyContent(message.session_id) : undefined,
        model: "model" in message ? stringifyContent(message.model) : undefined,
        tools: "tools" in message && Array.isArray(message.tools) ? message.tools.length : undefined,
        mcpServers:
          "mcp_servers" in message && Array.isArray(message.mcp_servers)
            ? message.mcp_servers.length
            : undefined,
        permissionMode:
          "permissionMode" in message ? stringifyContent(message.permissionMode) : undefined,
      });
      return;
    }

    if (subtype === "task_started") {
      logAgentEvent("runtime", "subtask:start", "子任务开始", {
        taskId: "task_id" in message ? stringifyContent(message.task_id) : undefined,
        taskType: "task_type" in message ? stringifyContent(message.task_type) : undefined,
        description: "description" in message ? stringifyContent(message.description) : undefined,
      });
      return;
    }

    if (subtype === "task_progress") {
      const usage = "usage" in message && isRecord(message.usage) ? message.usage : undefined;
      logAgentEvent(
        "runtime",
        "subtask:progress",
        "子任务进度",
        {
          taskId: "task_id" in message ? stringifyContent(message.task_id) : undefined,
          description: "description" in message ? stringifyContent(message.description) : undefined,
          totalTokens: usage?.total_tokens,
          toolUses: usage?.tool_uses,
          duration: formatDurationMs(usage?.duration_ms),
          lastTool: "last_tool_name" in message ? stringifyContent(message.last_tool_name) : undefined,
          summary: "summary" in message ? stringifyContent(message.summary) : undefined,
        },
        { verbose: true }
      );
      return;
    }

    if (subtype === "task_notification") {
      const usage = "usage" in message && isRecord(message.usage) ? message.usage : undefined;
      logAgentEvent("runtime", "subtask:done", "子任务结束", {
        taskId: "task_id" in message ? stringifyContent(message.task_id) : undefined,
        status: "status" in message ? stringifyContent(message.status) : undefined,
        totalTokens: usage?.total_tokens,
        toolUses: usage?.tool_uses,
        duration: formatDurationMs(usage?.duration_ms),
        summary: "summary" in message ? stringifyContent(message.summary) : undefined,
      });
      return;
    }

    if (subtype === "compact_boundary") {
      const metadata =
        "compact_metadata" in message && isRecord(message.compact_metadata)
          ? message.compact_metadata
          : undefined;
      logAgentEvent(
        "runtime",
        "sdk:compact",
        "SDK 上下文压缩边界",
        {
          trigger: metadata?.trigger,
          preTokens: metadata?.pre_tokens,
        },
        { verbose: true }
      );
      return;
    }

    logAgentEvent(
      "runtime",
      "sdk:system",
      "SDK system 消息",
      {
        subtype,
        detail: truncateLogText(stringifyContent(message), 500),
      },
      { verbose: true }
    );
  }

  private logResultMessage(message: Extract<SDKMessage, { type: "result" }>): void {
    const subtype = typeof message.subtype === "string" ? message.subtype : "unknown";
    const isError = "is_error" in message && message.is_error === true;
    logAgentEvent("runtime", "sdk:result", "SDK 返回结果", {
      status: isError ? "error" : "success",
      subtype,
      turns: "num_turns" in message ? message.num_turns : undefined,
      total: "duration_ms" in message ? formatDurationMs(message.duration_ms) : undefined,
      api: "duration_api_ms" in message ? formatDurationMs(message.duration_api_ms) : undefined,
      stop: "stop_reason" in message ? message.stop_reason : undefined,
    });

    const usageFields = {
      cost: "total_cost_usd" in message ? formatCostUsd(message.total_cost_usd) : undefined,
      ...summarizeSdkUsage("usage" in message ? message.usage : undefined),
    };
    if (hasLogFields(usageFields)) {
      logAgentEvent("post", "usage", "本次消耗", usageFields);
    }

    if (message.subtype === "success" && typeof message.result === "string" && message.result.trim()) {
      logAgentEvent(
        "runtime",
        "sdk:result:detail",
        "SDK 结果内容",
        {
          summary: message.result.trim(),
        },
        { verbose: true }
      );
      return;
    }

    if ("errors" in message && Array.isArray(message.errors) && message.errors.length > 0) {
      logAgentEvent(
        "runtime",
        "sdk:error",
        "SDK 返回错误",
        {
          errors: message.errors.join(" | "),
        },
        { level: "error" }
      );
    }
  }

  private logAuthStatus(message: Extract<SDKMessage, { type: "auth_status" }>): void {
    const output = Array.isArray(message.output) ? message.output.join("\n").trim() : "";
    logAgentEvent(
      "runtime",
      "sdk:auth-status",
      "SDK 认证状态",
      {
        isAuthenticating: message.isAuthenticating,
        output: output ? truncateLogText(output, 500) : undefined,
        error: message.error,
      },
      { verbose: true }
    );
  }
}

function isAbortLikeError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted/i.test(error.message))
  );
}

function isExpectedStopError(error: unknown) {
  return (
    isAbortLikeError(error) ||
    (error instanceof Error &&
      /query closed|closed before response|operation aborted/i.test(error.message))
  );
}

function startInterrupt(run: ActiveAgentRun, sessionId: string): void {
  let interruptPromise: Promise<void>;
  try {
    interruptPromise = run.query.interrupt();
  } catch (error) {
    interruptPromise = Promise.reject(error);
  }

  void interruptPromise.catch((error) => {
    if (!isExpectedStopError(error)) {
      logAgentEvent(
        "runtime",
        "sdk:error",
        "SDK 返回错误",
        {
          profile: run.profileName,
          session: sessionId,
          operation: "interrupt",
          reason: error instanceof Error ? error.message : stringifyContent(error),
        },
        { level: "error" }
      );
    }
  });
}

function getMissingSdkSessionError(message: SDKMessage): MissingSdkSessionError | null {
  if (
    message.type !== "result" ||
    message.subtype !== "error_during_execution" ||
    !Array.isArray(message.errors)
  ) {
    return null;
  }

  const matched = message.errors.find((item) =>
    typeof item === "string" && /No conversation found with session ID:/i.test(item)
  );

  if (!matched) {
    return null;
  }

  const sessionIdMatch = matched.match(/session ID:\s*([a-f0-9-]+)/i);
  return new MissingSdkSessionError(matched, sessionIdMatch?.[1]);
}

export function isAgentRunningForSession(sessionId: string): boolean {
  return activeAgentRuns.has(sessionId);
}

export function getAgentRunInfo(sessionId: string): AgentRunInfo {
  const run = activeAgentRuns.get(sessionId);
  if (!run) {
    return { running: false };
  }

  return {
    running: true,
    source: run.source,
  };
}

export async function runAgentWithProfile(
  sessionId: string,
  profile: QueryProfile,
  onEvent: AgentEventForwarder,
  attachments?: FileAttachment[],
  workspaceId = "default",
  source: AgentRunSource = "desktop",
  attachmentProjection: AttachmentProjectionOptions = { imageMode: "neutral" }
): Promise<AgentRunResult> {
  if (activeAgentRuns.has(sessionId)) {
    throw new Error(`An agent is already running for session ${sessionId}.`);
  }

  const agentName = formatAgentName(profile.name);
  const ownsLoop = profile.name === "memory" && !isAgentLoopActiveFor("memory");
  const loopStartedAt = Date.now();
  let loopStatus: "success" | "error" | "stopped" = "success";
  const rawOptions = profile.options as Record<string, unknown>;
  const resumeSessionId = typeof rawOptions.resume === "string" ? rawOptions.resume : undefined;

  if (ownsLoop) {
    logAgentLoopStart(agentName, {
      query: "memory extraction",
      session: sessionId,
      source,
      workspace: workspaceId,
    });
  }

  logAgentEvent("pre", "session", "会话上下文已确认", {
    resume: Boolean(resumeSessionId),
    sdkSessionId: resumeSessionId,
    cwd: typeof rawOptions.cwd === "string" ? rawOptions.cwd : undefined,
  });
  logAgentEvent("pre", "ready", "运行参数已准备", summarizePreparedOptions(profile.options));
  if (isVerboseAgentLoopLog()) {
    logAgentEvent(
      "pre",
      "ready:detail",
      "运行参数详情",
      {
        options: summarizeQueryOptions(profile.options),
      },
      { verbose: true }
    );
    logAgentEvent(
      "pre",
      "prompt:detail",
      "SDK prompt 内容",
      {
        chars: profile.prompt.length,
        prompt: profile.prompt,
      },
      { verbose: true }
    );
  }

  await ensureZoraDir();
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const userContent =
    attachments && attachments.length > 0
      ? buildMultimodalPrompt(profile.prompt, attachments, attachmentProjection)
      : profile.prompt;
  const inputStream = new AgentInputStream();

  const readyPromise = new Promise<void>((resolve) => {
    queryReadyResolvers.set(sessionId, resolve);
  });
  queryReadyPromises.set(sessionId, readyPromise);

  const enqueueInitialPrompt = async () => {
    if (typeof userContent === "string") {
      inputStream.enqueue({
        type: "user" as const,
        session_id: sessionId,
        message: { role: "user" as const, content: userContent },
        parent_tool_use_id: null,
      });
      return;
    }

    for await (const message of userContent) {
      inputStream.enqueue({
        ...message,
        session_id: sessionId,
      });
    }
  };

  let response;
  try {
    await enqueueInitialPrompt();
    activeInputStreams.set(sessionId, inputStream);
    response = query({
      prompt: inputStream,
      options: profile.options,
    });
    logAgentEvent("runtime", "sdk:query", "请求已提交给 SDK", {
      prompt: "inputStream",
      attachments: attachments?.length ?? 0,
      includePartialMessages: rawOptions.includePartialMessages,
    });
  } catch (error) {
    loopStatus = "error";
    inputStream.fail(error);
    activeInputStreams.delete(sessionId);
    queryReadyPromises.delete(sessionId);
    queryReadyResolvers.delete(sessionId);
    pendingQueuedMessageUuids.delete(sessionId);
    queuedMessagePayloads.delete(sessionId);
    throw error;
  }

  activeQueries.set(sessionId, response);
  const resolveReady = queryReadyResolvers.get(sessionId);
  if (resolveReady) {
    resolveReady();
    queryReadyResolvers.delete(sessionId);
  }

  const run: ActiveAgentRun = {
    query: response,
    stopping: false,
    source,
    profileName: profile.name,
    attachmentProjection,
  };
  activeAgentRuns.set(sessionId, run);
  emitAgentStatus("started", onEvent, source);

  let missingSdkSessionError: MissingSdkSessionError | null = null;
  let latestSdkSessionId: string | undefined;
  const lateQueuedMessages: QueuedAgentMessage[] = [];
  const sdkLogger = new SdkMessageConsoleLogger(onEvent);

  try {
    for await (const message of response) {
      let shouldFinishAfterResult = false;

      if (
        message.type === "user" &&
        "isReplay" in message &&
        message.isReplay === true &&
        typeof message.uuid === "string"
      ) {
        pendingQueuedMessageUuids.get(sessionId)?.delete(message.uuid);
        queuedMessagePayloads.get(sessionId)?.delete(message.uuid);
      }

      if (message.type === "system" && message.subtype === "init") {
        const sid = message.session_id;
        if (typeof sid === "string" && sid.length > 0) {
          latestSdkSessionId = sid;
          void setSdkSessionId(sessionId, sid, workspaceId);
        }
      }

      if (message.type === "result") {
        const sid = message.session_id;
        if (typeof sid === "string" && sid.length > 0) {
          latestSdkSessionId = sid;
          void setSdkSessionId(sessionId, sid, workspaceId);
        }

        const detectedMissingSession = getMissingSdkSessionError(message);
        if (detectedMissingSession) {
          missingSdkSessionError = detectedMissingSession;
        }

        const pendingQueuedUuids = pendingQueuedMessageUuids.get(sessionId);
        if (pendingQueuedUuids && pendingQueuedUuids.size > 0) {
          const payloads = queuedMessagePayloads.get(sessionId);
          for (const uuid of pendingQueuedUuids) {
            const queuedMessage = payloads?.get(uuid);
            if (queuedMessage) {
              lateQueuedMessages.push(queuedMessage);
            }
          }

          logAgentEvent("runtime", "queue:replay", "队列消息需要补跑", {
            pendingMessages: pendingQueuedUuids.size,
            reason: "result_arrived_without_replay_ack",
          });
          pendingQueuedUuids.clear();
        }
        shouldFinishAfterResult = true;
      }

      sdkLogger.log(message);

      if (shouldFinishAfterResult) {
        break;
      }
    }

    if (missingSdkSessionError) {
      throw missingSdkSessionError;
    }
    emitAgentStatus(run.stopping ? "stopped" : "finished", onEvent, source);
    loopStatus = run.stopping ? "stopped" : "success";
  } catch (error) {
    loopStatus = run.stopping ? "stopped" : "error";
    if (missingSdkSessionError) {
      throw missingSdkSessionError;
    }

    if (!run.stopping || !isAbortLikeError(error)) {
      emitAgentError(error, onEvent, profile.name);
    }
    emitAgentStatus(run.stopping ? "stopped" : "finished", onEvent, source);
  } finally {
    inputStream.close();
    try {
      response.close();
    } catch {
      // Ignore close errors while tearing down a finished or aborted run.
    }
    clearAllPending();
    activeQueries.delete(sessionId);
    activeInputStreams.delete(sessionId);
    queryReadyPromises.delete(sessionId);
    queryReadyResolvers.delete(sessionId);
    queuedMessageUuids.delete(sessionId);
    pendingQueuedMessageUuids.delete(sessionId);
    queuedMessagePayloads.delete(sessionId);
    if (activeAgentRuns.get(sessionId) === run) {
      activeAgentRuns.delete(sessionId);
    }
    if (ownsLoop) {
      logAgentLoopEnd(agentName, {
        status: loopStatus,
        totalDuration: formatDurationMs(Date.now() - loopStartedAt),
        session: sessionId,
        workspace: workspaceId,
      });
    }
  }

  return {
    lateQueuedMessages,
    sdkSessionId: latestSdkSessionId,
  };
}

export async function sendQueuedMessage(
  sessionId: string,
  text: string,
  uuid?: string,
  attachments?: FileAttachment[]
): Promise<string> {
  const activeRun = activeAgentRuns.get(sessionId);
  if (!activeRun) {
    throw new Error("会话未运行，无法追加消息");
  }

  const messageUuid = uuid || randomUUID();
  const uuids = queuedMessageUuids.get(sessionId) ?? new Set<string>();
  if (uuids.has(messageUuid)) {
    logAgentEvent(
      "runtime",
      "queue:received",
      "队列消息已确认",
      {
        session: sessionId,
        uuid: messageUuid,
        action: "duplicate_ignored",
        text,
      },
      { verbose: true }
    );
    return messageUuid;
  }

  uuids.add(messageUuid);
  queuedMessageUuids.set(sessionId, uuids);
  const pendingUuids = pendingQueuedMessageUuids.get(sessionId) ?? new Set<string>();
  pendingUuids.add(messageUuid);
  pendingQueuedMessageUuids.set(sessionId, pendingUuids);
  const payloads = queuedMessagePayloads.get(sessionId) ?? new Map<string, QueuedAgentMessage>();
  payloads.set(messageUuid, { uuid: messageUuid, text, attachments });
  queuedMessagePayloads.set(sessionId, payloads);

  const readyPromise = queryReadyPromises.get(sessionId);
  if (readyPromise) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("等待 SDK 初始化超时")),
        QUERY_READY_TIMEOUT_MS
      );
    });

    try {
      await Promise.race([readyPromise, timeout]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  if (!activeQueries.has(sessionId)) {
    uuids.delete(messageUuid);
    pendingUuids.delete(messageUuid);
    payloads.delete(messageUuid);
    throw new Error("无活跃查询可注入消息");
  }

  const inputStream = activeInputStreams.get(sessionId);
  if (!inputStream) {
    uuids.delete(messageUuid);
    pendingUuids.delete(messageUuid);
    payloads.delete(messageUuid);
    throw new Error("无活跃输入流可注入消息");
  }

  const attachmentBlocks = attachmentsToContentBlocks(
    attachments ?? [],
    activeRun.attachmentProjection
  );
  const sdkMessage: SDKUserMessage = {
    type: "user" as const,
    session_id: sessionId,
    message: {
      role: "user" as const,
      content: attachmentBlocks.length > 0
        ? [{ type: "text" as const, text }, ...attachmentBlocks]
        : text,
    },
    parent_tool_use_id: null,
    priority: "next" as const,
    uuid: messageUuid as SdkMessageUuid,
  };

  try {
    inputStream.enqueue(sdkMessage);
    logAgentEvent(
      "runtime",
      "queue:received",
      "队列消息已确认",
      {
        session: sessionId,
        uuid: messageUuid,
        action: "enqueued",
        priority: "next",
        text,
      },
      { verbose: true }
    );
    return messageUuid;
  } catch (error) {
    uuids.delete(messageUuid);
    pendingUuids.delete(messageUuid);
    payloads.delete(messageUuid);
    throw error;
  }
}

export async function stopAgentForSession(sessionId: string) {
  const run = activeAgentRuns.get(sessionId);
  if (!run) {
    return;
  }
  if (run.stopping) {
    return;
  }
  run.stopping = true;

  startInterrupt(run, sessionId);
  activeInputStreams.get(sessionId)?.close();
  try {
    run.query.close();
  } catch (error) {
    logAgentEvent(
      "runtime",
      "sdk:error",
      "SDK 返回错误",
      {
        profile: run.profileName,
        session: sessionId,
        operation: "close",
        reason: error instanceof Error ? error.message : stringifyContent(error),
      },
      { level: "error" }
    );
  }
}
