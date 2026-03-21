import { app } from "electron";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type {
  AgentRunInfo,
  AgentRunSource,
  AgentStatus,
  AgentStreamEvent,
  FileAttachment,
} from "../shared/zora";
import { buildMultimodalPrompt } from "./attachment-handler";
import { clearAllPending } from "./hitl";
import { memoryAgent } from "./memory-agent";
import { ensureZoraDir } from "./memory-store";
import type { QueryProfile } from "./query-profiles/types";
import { setSessionId } from "./session-manager";
import { setSdkSessionId } from "./session-store";

type JsonRecord = Record<string, unknown>;
export type AgentEventForwarder = (event: AgentStreamEvent) => void;

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
};

const activeAgentRuns = new Map<string, ActiveAgentRun>();

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

function truncateForLog(value: string, maxChars = 1600): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...(${value.length} chars)`;
}

function getProfileLogPrefix(profileName: QueryProfile["name"]): string {
  return `[${profileName}]`;
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

function logAssistantToolUses(message: unknown, prefix: string): boolean {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return false;
  }

  let logged = false;

  for (const block of message.content) {
    if (!isRecord(block) || block.type !== "tool_use") {
      continue;
    }

    const toolName = typeof block.name === "string" ? block.name : "unknown";
    const toolInput = "input" in block ? stringifyContent(block.input) : "";
    console.log(`${prefix}[tool_use:${toolName}]`, toolInput);
    logged = true;
  }

  return logged;
}

function logStreamToolUse(event: unknown, prefix: string): boolean {
  if (
    !isRecord(event) ||
    event.type !== "content_block_start" ||
    !isRecord(event.content_block) ||
    event.content_block.type !== "tool_use"
  ) {
    return false;
  }

  const toolName =
    typeof event.content_block.name === "string" ? event.content_block.name : "unknown";
  const toolInput = "input" in event.content_block ? stringifyContent(event.content_block.input) : "";
  console.log(`${prefix}[tool_use:${toolName}]`, toolInput);
  return true;
}

function extractStreamContent(event: unknown): string {
  if (!isRecord(event)) {
    return stringifyContent(event);
  }

  if (event.type === "content_block_delta") {
    const delta = isRecord(event.delta) ? event.delta : undefined;

    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return delta.text;
    }

    return stringifyContent(delta);
  }

  if (event.type === "content_block_start") {
    return stringifyContent(event.content_block);
  }

  if (event.type === "message_delta") {
    return stringifyContent(event.delta);
  }

  return stringifyContent(event);
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

  const logPrefix = profileName ? getProfileLogPrefix(profileName) : "[runtime]";
  console.error(`${logPrefix} Claude Agent SDK chat failed.`);
  console.error(error);
  onEvent?.(payload);
}

function logSdkMessage(
  message: SDKMessage,
  profileName: QueryProfile["name"],
  onEvent?: AgentEventForwarder
) {
  onEvent?.(message as AgentStreamEvent);

  if (profileName === "memory") {
    const memoryPrefix = getProfileLogPrefix(profileName);
    if (message.type !== "stream_event") {
      const messageSubtype =
        "subtype" in message && typeof message.subtype === "string" ? `:${message.subtype}` : "";
      console.log(
        `${memoryPrefix}[raw:${message.type}${messageSubtype}]`,
        truncateForLog(stringifyContent(message))
      );
    }

    if (message.type === "system") {
      const subtype = typeof message.subtype === "string" ? message.subtype : "unknown";
      if (subtype === "init" && "model" in message) {
        console.log(
          `${memoryPrefix}[system:${subtype}] session=${stringifyContent(message.session_id)} model=${stringifyContent(message.model)}`
        );
      } else {
        console.log(`${memoryPrefix}[system:${subtype}]`, stringifyContent(message));
      }
      return;
    }

    if (message.type === "result") {
      const subtype = typeof message.subtype === "string" ? message.subtype : "unknown";
      console.log(`${memoryPrefix}[result:${subtype}]`);
      return;
    }

    if (message.type === "auth_status") {
      const output = Array.isArray(message.output) ? message.output.join("\n") : "";
      const error = typeof message.error === "string" ? ` error=${message.error}` : "";
      console.log(`${memoryPrefix}[auth_status]`, `${output}${error}`.trim());
      return;
    }

    if (message.type === "assistant") {
      if (!logAssistantToolUses(message.message, memoryPrefix)) {
        console.log(`${memoryPrefix}[assistant]`, extractAssistantContent(message.message));
      }
      return;
    }

    if (message.type === "stream_event") {
      const event = message.event;
      logStreamToolUse(event, memoryPrefix);
      return;
    }

    if (message.type === "tool_progress") {
      console.log(
        `${memoryPrefix}[tool_progress:${message.tool_name}]`,
        `tool_use_id=${message.tool_use_id} elapsed=${message.elapsed_time_seconds}s`
      );
      return;
    }

    if (message.type === "tool_use_summary") {
      console.log(`${memoryPrefix}[tool_summary]`, message.summary);
      return;
    }

    if (message.type === "user" && message.tool_use_result !== undefined) {
      console.log(`${memoryPrefix}[tool_result]`, stringifyContent(message.tool_use_result));
      return;
    }

    console.log(`${memoryPrefix}[${message.type}]`, stringifyContent(message));
    return;
  }

  const profilePrefix = getProfileLogPrefix(profileName);

  if (message.type === "stream_event") {
    const event = message.event;
    const eventType = isRecord(event) && typeof event.type === "string" ? event.type : "unknown";
    const content = extractStreamContent(event);
    console.log(`${profilePrefix}[stream_event:${eventType}]`, content);
    return;
  }

  if (message.type === "assistant") {
    console.log(`${profilePrefix}[assistant]`, extractAssistantContent(message.message));
    return;
  }

  if (message.type === "result") {
    const subtype = typeof message.subtype === "string" ? message.subtype : "unknown";
    const content =
      message.subtype === "success"
        ? message.result
        : Array.isArray(message.errors)
          ? message.errors.join(" | ")
          : stringifyContent(message);

    console.log(`${profilePrefix}[result:${subtype}]`, content);
    return;
  }

  if (message.type === "system") {
    const subtype = typeof message.subtype === "string" ? message.subtype : "unknown";
    const content =
      subtype === "init" && "model" in message
        ? `session=${stringifyContent(message.session_id)} model=${stringifyContent(message.model)}`
        : stringifyContent(message);

    console.log(`${profilePrefix}[system:${subtype}]`, content);
    return;
  }

  if (message.type === "auth_status") {
    const output = Array.isArray(message.output) ? message.output.join("\n") : "";
    const error = typeof message.error === "string" ? ` error=${message.error}` : "";
    console.log(`${profilePrefix}[auth_status]`, `${output}${error}`.trim());
    return;
  }

  console.log(`${profilePrefix}[${message.type}]`, stringifyContent(message));
}

export function resolveSDKCliPath(): string {
  let cliPath: string | null = null;

  try {
    const cjsRequire = createRequire(__filename);
    const sdkEntryPath = cjsRequire.resolve("@anthropic-ai/claude-agent-sdk");
    cliPath = join(dirname(sdkEntryPath), "cli.js");
    console.log(`[sdk] CLI path (createRequire): ${cliPath}`);
  } catch (error) {
    console.warn("[sdk] createRequire failed to resolve SDK CLI path.", error);
  }

  if (!cliPath) {
    try {
      cliPath = join(
        dirname(require.resolve("@anthropic-ai/claude-agent-sdk")),
        "cli.js"
      );
      console.log(`[sdk] CLI path (require.resolve): ${cliPath}`);
    } catch (error) {
      console.warn("[sdk] require.resolve failed to resolve SDK CLI path.", error);
    }
  }

  if (!cliPath) {
    cliPath = join(
      process.cwd(),
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk",
      "cli.js"
    );
    console.log(`[sdk] CLI path (fallback): ${cliPath}`);
  }

  if (app.isPackaged && cliPath.includes(".asar")) {
    cliPath = cliPath.replace(/\.asar([/\\])/, ".asar.unpacked$1");
    console.log(`[sdk] CLI path (asar.unpacked): ${cliPath}`);
  }

  return cliPath;
}

function isAbortLikeError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted/i.test(error.message))
  );
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
  source: AgentRunSource = "desktop"
): Promise<void> {
  if (activeAgentRuns.has(sessionId)) {
    throw new Error(`An agent is already running for session ${sessionId}.`);
  }

  const logPrefix = getProfileLogPrefix(profile.name);
  console.log(`${logPrefix} Starting query`);
  console.log(`${logPrefix} Resume session: ${(profile.options as any).resume ?? "(new session)"}`);
  console.log(`${logPrefix} Permission mode: ${(profile.options as any).permissionMode}`);

  await ensureZoraDir();
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const prompt =
    attachments && attachments.length > 0
      ? buildMultimodalPrompt(profile.prompt, attachments)
      : profile.prompt;

  const response = query({ prompt, options: profile.options as any });

  const run: ActiveAgentRun = {
    query: response,
    stopping: false,
    source,
    profileName: profile.name,
  };
  activeAgentRuns.set(sessionId, run);
  emitAgentStatus("started", onEvent, source);

  let missingSdkSessionError: MissingSdkSessionError | null = null;

  try {
    for await (const message of response) {
      if (message.type === "system" && message.subtype === "init") {
        const sid = message.session_id;
        if (typeof sid === "string" && sid.length > 0) {
          if (sessionId === "__awakening__") {
            setSessionId("awakening", sid);
          } else {
            void setSdkSessionId(sessionId, sid, workspaceId);
          }
        }
      }

      if (message.type === "result") {
        const sid = message.session_id;
        if (typeof sid === "string" && sid.length > 0) {
          if (sessionId === "__awakening__") {
            setSessionId("awakening", sid);
          } else {
            void setSdkSessionId(sessionId, sid, workspaceId);
          }
        }

        const detectedMissingSession = getMissingSdkSessionError(message);
        if (detectedMissingSession) {
          missingSdkSessionError = detectedMissingSession;
        }
      }

      logSdkMessage(message, profile.name, onEvent);
    }
    console.log(`${logPrefix} Query finished`);
    if (
      !run.stopping &&
      profile.name !== "memory" &&
      profile.name !== "awakening"
    ) {
      memoryAgent.onConversationEnd(sessionId, workspaceId).catch((err) => {
        console.error(`${logPrefix} Memory extraction failed:`, err);
      });
    }
    emitAgentStatus(run.stopping ? "stopped" : "finished", onEvent, source);
  } catch (error) {
    if (missingSdkSessionError) {
      throw missingSdkSessionError;
    }

    if (!run.stopping || !isAbortLikeError(error)) {
      emitAgentError(error, onEvent, profile.name);
    }
    emitAgentStatus(run.stopping ? "stopped" : "finished", onEvent, source);
  } finally {
    try {
      response.close();
    } catch {
      // Ignore close errors while tearing down a finished or aborted run.
    }
    clearAllPending();
    if (activeAgentRuns.get(sessionId) === run) {
      activeAgentRuns.delete(sessionId);
    }
  }
}

export async function stopAgentForSession(sessionId: string) {
  const run = activeAgentRuns.get(sessionId);
  if (!run) {
    return;
  }
  run.stopping = true;

  try {
    await run.query.interrupt();
  } catch (error) {
    if (!isAbortLikeError(error)) {
      console.warn(
        `${getProfileLogPrefix(run.profileName)} Failed to interrupt agent for session ${sessionId}.`,
        error
      );
    }
  } finally {
    try {
      run.query.close();
    } catch (error) {
      console.warn(
        `${getProfileLogPrefix(run.profileName)} Failed to close agent for session ${sessionId}.`,
        error
      );
    }
  }
}
