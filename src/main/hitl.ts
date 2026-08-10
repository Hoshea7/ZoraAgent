import type {
  AgentStreamEvent,
  AskUserQuestionRequest as SharedAskUserQuestionRequest,
  PermissionMode,
  PermissionRequest,
} from "../shared/zora";
import { isSafeBuiltinMcpToolName } from "../shared/types/mcp";
import { INSPECT_IMAGE_CANONICAL_NAME } from "../shared/types/vision";
import { logAgentEvent, truncateLogText } from "./agent-loop-log";
import { ZORA_SCHEDULE_MANAGE_FULL_TOOL_NAME } from "./builtin-mcp/schedule";
import { parseAskUserQuestionSpecs } from "./runtime/tool-gate";
import type {
  AskUserQuestionRequest,
  ToolAuthorizationDecision,
  ToolAuthorizationRequest,
} from "./runtime/tool-gate";

type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

interface CanUseToolOptions {
  signal: AbortSignal;
  suggestions?: unknown[];
  blockedPath?: string;
  decisionReason?: string;
  toolUseID: string;
  agentID?: string;
}

type PendingPermission = {
  resolve: (result: PermissionResult) => void;
  request: PermissionRequest;
  sessionId: string;
};

type PendingAskUserQuestion = {
  resolve: (answers: Record<string, string>) => void;
  reject: (error: Error) => void;
  request: SharedAskUserQuestionRequest;
  onEvent: AgentEventForwarder;
  signal: AbortSignal;
  handleAbort: () => void;
};

interface SessionWhitelist {
  allowedTools: Set<string>;
  allowedBashCommands: Set<string>;
}

type JsonRecord = Record<string, unknown>;
type AgentEventForwarder = (event: AgentStreamEvent) => void;

const pendingPermissions = new Map<string, PendingPermission>();
const pendingAskUserQuestions = new Map<string, PendingAskUserQuestion>();
const sessionWhitelists = new Map<string, SessionWhitelist>();
const sessionPermissionModes = new Map<string, PermissionMode>();

let defaultPermissionMode: PermissionMode = "ask";

const SAFE_TOOLS = new Set([
  "Read", "Glob", "Grep", "WebSearch", "WebFetch",
  "TodoRead", "TodoWrite", "TaskOutput",
  "ListMcpResources", "ReadMcpResource", "ExitPlanMode", "AskUserQuestion",
]);

const SMART_AUTO_ALLOW_TOOLS = new Set([
  "Write", "Edit", "MultiEdit", "NotebookEdit",
  "Agent",
  "Task", "TaskStop",
]);

const BLOCKED_SCHEDULE_FALLBACK_TOOLS = new Set([
  "cron",
  "croncreate",
  "cronupdate",
  "crondelete",
  "cronlist",
  "cronget",
]);

const READ_ONLY_SCHEDULE_ACTIONS = new Set(["list", "get"]);

const SAFE_BASH_PATTERNS = [
  /^git\s+(status|log|diff|show|branch|remote|tag)\b/,
  /^ls\b/, /^head\b/, /^tail\b/, /^grep\b/, /^rg\b/,
  /^which\b/, /^pwd$/, /^env$/, /^whoami$/,
  /^cat\b/, /^echo\b/, /^tree\b/, /^wc\b/, /^file\b/,
  /^node\s+--version$/, /^bun\s+--version$/,
  /^npm\s+(list|ls|view|info|outdated)\b/,
];

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

function summarizeToolInput(input: Record<string, unknown>) {
  return {
    keys: Object.keys(input),
    preview: stringifyContent(input).slice(0, 300),
  };
}

function summarizeToolForLog(
  toolName: string,
  toolUseID: string,
  input: Record<string, unknown>
) {
  return {
    tool: toolName,
    toolUseId: toolUseID,
    command: typeof input.command === "string" ? truncateLogText(input.command, 240) : undefined,
    file:
      typeof input.file_path === "string"
        ? input.file_path
        : typeof input.path === "string"
          ? input.path
          : undefined,
  };
}

function extractBaseCommand(input: Record<string, unknown>): string | null {
  if (typeof input.command !== "string") {
    return null;
  }

  const words = input.command.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return null;
  }

  return words.slice(0, 2).join(" ");
}

function isDangerousCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  return [
    /(^|[\s;&|])sudo(\s|$)/,
    /\brm\s+-(?=[^\s]*r)(?=[^\s]*f)[^\s]*\s+\/(?:\s|$|[*;&|])/,
    /\bdd\b[\s\S]*\bof=/,
    /\bmkfs(?:\.[A-Za-z0-9_-]+)?\b/,
    />{1,2}\s*\/dev\//,
  ].some((pattern) => pattern.test(trimmed));
}

function getSessionWhitelist(sessionId: string): SessionWhitelist {
  let whitelist = sessionWhitelists.get(sessionId);
  if (!whitelist) {
    whitelist = {
      allowedTools: new Set<string>(),
      allowedBashCommands: new Set<string>(),
    };
    sessionWhitelists.set(sessionId, whitelist);
  }
  return whitelist;
}

function isWhitelisted(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>
): boolean {
  const whitelist = sessionWhitelists.get(sessionId);
  if (!whitelist) {
    return false;
  }

  if (toolName !== "Bash") {
    return whitelist.allowedTools.has(toolName);
  }

  const command = typeof input.command === "string" ? input.command : "";
  if (isDangerousCommand(command)) {
    logAgentEvent("runtime", "hitl:deny", "工具权限被拒绝", {
      tool: toolName,
      reason: "dangerous_whitelisted_bash",
      command: truncateLogText(command, 200),
    });
    return false;
  }

  const baseCommand = extractBaseCommand(input);
  return baseCommand !== null && whitelist.allowedBashCommands.has(baseCommand);
}

function addToWhitelist(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>
): void {
  const whitelist = getSessionWhitelist(sessionId);

  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    if (isDangerousCommand(command)) {
      logAgentEvent(
        "runtime",
        "hitl:whitelist",
        "权限白名单跳过",
        {
          tool: toolName,
          reason: "dangerous_bash",
          command: truncateLogText(command, 200),
        },
        { verbose: true }
      );
      return;
    }

    const baseCommand = extractBaseCommand(input);
    if (!baseCommand) {
      logAgentEvent(
        "runtime",
        "hitl:whitelist",
        "权限白名单跳过",
        {
          tool: toolName,
          reason: "missing_base_command",
        },
        { verbose: true }
      );
      return;
    }

    whitelist.allowedBashCommands.add(baseCommand);
    logAgentEvent(
      "runtime",
      "hitl:whitelist",
      "权限白名单已更新",
      {
        tool: toolName,
        baseCommand,
      },
      { verbose: true }
    );
    return;
  }

  whitelist.allowedTools.add(toolName);
  logAgentEvent(
    "runtime",
    "hitl:whitelist",
    "权限白名单已更新",
    {
      tool: toolName,
    },
    { verbose: true }
  );
}

export function clearSessionWhitelist(sessionId: string): void {
  sessionPermissionModes.delete(sessionId);
  if (sessionWhitelists.delete(sessionId)) {
    logAgentEvent(
      "runtime",
      "hitl:whitelist",
      "权限白名单已清理",
      undefined,
      { verbose: true }
    );
  }
}

function isSafeBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (/[|;&]|>{1,2}|\$\(|`/.test(trimmed)) {
    return false;
  }
  return SAFE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function getTerminalToolName(toolName: string): string {
  const cleaned = toolName.replace(/^default_api:/, "").trim();
  const parts = cleaned.split("__").filter(Boolean);
  return (parts[parts.length - 1] ?? cleaned).toLowerCase();
}

function isBlockedScheduleFallbackTool(toolName: string): boolean {
  return BLOCKED_SCHEDULE_FALLBACK_TOOLS.has(getTerminalToolName(toolName));
}

function isReadOnlyScheduleManageInput(input: Record<string, unknown>): boolean {
  return (
    typeof input.action === "string" &&
    READ_ONLY_SCHEDULE_ACTIONS.has(input.action)
  );
}

function isAutoAllowedTool(toolName: string, input: Record<string, unknown>): boolean {
  if (SAFE_TOOLS.has(toolName)) {
    return true;
  }

  if (isSafeBuiltinMcpToolName(toolName)) {
    return true;
  }

  if (toolName === INSPECT_IMAGE_CANONICAL_NAME) {
    return true;
  }

  if (toolName === ZORA_SCHEDULE_MANAGE_FULL_TOOL_NAME) {
    return isReadOnlyScheduleManageInput(input);
  }

  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    return isSafeBashCommand(command);
  }

  return false;
}

function buildDescription(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash":
      return typeof input.command === "string"
        ? `执行命令: ${input.command.slice(0, 200)}`
        : "执行 Bash 命令";
    case "Write":
      return typeof input.file_path === "string"
        ? `写入文件: ${input.file_path}`
        : "写入文件";
    case "Edit":
      return typeof input.file_path === "string"
        ? `编辑文件: ${input.file_path}`
        : "编辑文件";
    case "Task":
    case "Agent":
      return typeof input.description === "string"
        ? `启动子任务: ${input.description}`
        : "启动子任务";
    default:
      return `使用工具: ${toolName}`;
  }
}

export function getPermissionMode(sessionId?: string): PermissionMode {
  if (!sessionId) {
    return defaultPermissionMode;
  }

  let mode = sessionPermissionModes.get(sessionId);
  if (!mode) {
    mode = defaultPermissionMode;
    sessionPermissionModes.set(sessionId, mode);
  }
  return mode;
}

export function setPermissionMode(mode: PermissionMode, sessionId?: string) {
  if (sessionId) {
    sessionPermissionModes.set(sessionId, mode);
    return;
  }

  defaultPermissionMode = mode;
  for (const existingSessionId of sessionPermissionModes.keys()) {
    sessionPermissionModes.set(existingSessionId, mode);
  }
}

export function askUserQuestion(
  onEvent: AgentEventForwarder,
  sessionId: string,
  req: AskUserQuestionRequest
): Promise<Record<string, string>> {
  const request: SharedAskUserQuestionRequest = {
    requestId: req.callId,
    questions: req.questions,
    toolInput: { questions: req.questions },
  };

  logAgentEvent("runtime", "hitl:ask", "等待用户回答", {
    session: sessionId,
    requestId: request.requestId,
    tool: "AskUserQuestion",
    questionCount: request.questions.length,
  });

  return new Promise<Record<string, string>>((resolve, reject) => {
    const handleAbort = () => {
      const pending = pendingAskUserQuestions.get(request.requestId);
      if (!pending) return;

      pendingAskUserQuestions.delete(request.requestId);
      req.signal.removeEventListener("abort", handleAbort);
      logAgentEvent("runtime", "hitl:abort", "用户提问中止", {
        session: sessionId,
        requestId: request.requestId,
        tool: "AskUserQuestion",
      });
      reject(new Error("操作已中止"));
    };

    pendingAskUserQuestions.set(request.requestId, {
      resolve,
      reject,
      request,
      onEvent,
      signal: req.signal,
      handleAbort,
    });

    if (req.signal.aborted) {
      handleAbort();
      return;
    }

    req.signal.addEventListener("abort", handleAbort, { once: true });
    onEvent({ type: "ask_user_request", request });
  });
}

async function authorizeToolPolicy(
  onEvent: AgentEventForwarder,
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
  options: CanUseToolOptions
): Promise<PermissionResult> {
    const withSession = (fields: Record<string, unknown> = {}) => ({
      session: sessionId,
      ...fields,
    });
    const allow = (): PermissionResult => ({
      behavior: "allow",
      updatedInput: input,
    });

    const permissionMode = getPermissionMode(sessionId);
    logAgentEvent(
      "runtime",
      "hitl:check",
      "检查工具权限",
      withSession({
        ...summarizeToolForLog(toolName, options.toolUseID, input),
        permissionMode,
        agentId: options.agentID,
      }),
      { verbose: true }
    );

    if (toolName === "AskUserQuestion") {
      try {
        const answers = await askUserQuestion(onEvent, sessionId, {
          questions: parseAskUserQuestionSpecs(input),
          callId: options.toolUseID,
          signal: options.signal,
        });
        return {
          behavior: "allow",
          updatedInput: { ...input, answers },
        };
      } catch (error) {
        return {
          behavior: "deny",
          message: error instanceof Error ? error.message : "操作已中止",
        };
      }
    }

    if (options.signal.aborted) {
      logAgentEvent("runtime", "hitl:abort", "权限检查中止", withSession({
        ...summarizeToolForLog(toolName, options.toolUseID, input),
      }));
      return { behavior: "deny", message: "操作已中止" };
    }

    if (isBlockedScheduleFallbackTool(toolName)) {
      logAgentEvent("runtime", "hitl:deny", "工具权限被拒绝", withSession({
        ...summarizeToolForLog(toolName, options.toolUseID, input),
        reason: "blocked_schedule_fallback_tool",
      }));
      return {
        behavior: "deny",
        message:
          "Zora 的定时任务必须使用 mcp__zora_schedule__zora_schedule_manage。不要使用 CronCreate、Claude Code cron 或其他临时 cron 工具；如果参数校验失败，请修正 zora_schedule_manage 参数后重试。",
      };
    }

    if (options.agentID && toolName !== ZORA_SCHEDULE_MANAGE_FULL_TOOL_NAME) {
      logAgentEvent(
        "runtime",
        "hitl:auto",
        "工具权限自动允许",
        withSession({
          ...summarizeToolForLog(toolName, options.toolUseID, input),
          reason: "subagent_tool_call",
        }),
        { verbose: true }
      );
      return allow();
    }

    if (isAutoAllowedTool(toolName, input)) {
      logAgentEvent(
        "runtime",
        "hitl:auto",
        "工具权限自动允许",
        withSession({
          ...summarizeToolForLog(toolName, options.toolUseID, input),
          reason: "readonly",
        }),
        { verbose: true }
      );
      return allow();
    }

    if (isWhitelisted(sessionId, toolName, input)) {
      logAgentEvent(
        "runtime",
        "hitl:auto",
        "工具权限自动允许",
        withSession({
          ...summarizeToolForLog(toolName, options.toolUseID, input),
          reason: "session_whitelist",
        }),
        { verbose: true }
      );
      return allow();
    }

    if (permissionMode === "yolo") {
      logAgentEvent(
        "runtime",
        "hitl:auto",
        "工具权限自动允许",
        withSession({
          ...summarizeToolForLog(toolName, options.toolUseID, input),
          reason: "permissionMode:yolo",
        }),
        { verbose: true }
      );
      return allow();
    }

    if (
      permissionMode === "smart" &&
      SMART_AUTO_ALLOW_TOOLS.has(toolName)
    ) {
      logAgentEvent(
        "runtime",
        "hitl:auto",
        "工具权限自动允许",
        withSession({
          ...summarizeToolForLog(toolName, options.toolUseID, input),
          reason: "permissionMode:smart",
        }),
        { verbose: true }
      );
      return allow();
    }

    const requestId = crypto.randomUUID();
    const command =
      toolName === "Bash" && typeof input.command === "string"
        ? input.command
        : undefined;
    const request: PermissionRequest = {
      requestId,
      toolName,
      toolInput: input,
      description: buildDescription(toolName, input),
      command,
    };
    logAgentEvent("runtime", "hitl:request", "等待用户授权", withSession({
      requestId,
      ...summarizeToolForLog(toolName, options.toolUseID, input),
      description: request.description,
    }));
    onEvent({ type: "permission_request", request });

    return new Promise<PermissionResult>((resolve) => {
      pendingPermissions.set(requestId, { resolve, request, sessionId });

      const handleAbort = () => {
        logAgentEvent("runtime", "hitl:abort", "权限请求中止", withSession({
          requestId,
          ...summarizeToolForLog(toolName, options.toolUseID, input),
        }));
        if (pendingPermissions.has(requestId)) {
          pendingPermissions.delete(requestId);
        }
        resolve({ behavior: "deny", message: "操作已中止" });
      };

      if (options.signal.aborted) {
        handleAbort();
        return;
      }

      options.signal.addEventListener("abort", handleAbort, { once: true });
    });
}

export function createCanUseTool(
  onEvent: AgentEventForwarder,
  sessionId: string
) {
  return (
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions
  ): Promise<PermissionResult> =>
    authorizeToolPolicy(onEvent, sessionId, toolName, input, options);
}

export async function authorizeProductTool(
  onEvent: AgentEventForwarder,
  sessionId: string,
  req: ToolAuthorizationRequest
): Promise<ToolAuthorizationDecision> {
  if (req.tool === "AskUserQuestion") {
    return req.signal.aborted
      ? { behavior: "deny", message: "操作已中止" }
      : { behavior: "allow" };
  }

  const result = await authorizeToolPolicy(
    onEvent,
    sessionId,
    req.tool,
    req.input,
    {
      signal: req.signal,
      toolUseID: req.callId,
      agentID: req.agentId,
    }
  );

  if (result.behavior === "deny") {
    return result;
  }

  return result.updatedInput !== req.input
    ? { behavior: "allow", input: result.updatedInput }
    : { behavior: "allow" };
}

export function respondToPermission(
  requestId: string,
  behavior: "allow" | "deny",
  alwaysAllow: boolean,
  userMessage?: string
) {
  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    logAgentEvent("runtime", "hitl:unknown", "收到未知权限响应", {
      requestId,
      behavior,
    });
    return;
  }

  logAgentEvent("runtime", "hitl:response", "用户授权已响应", {
    requestId,
    tool: pending.request.toolName,
    behavior,
    alwaysAllow,
    hasUserMessage: Boolean(userMessage?.trim()),
  });

  if (behavior === "allow") {
    if (alwaysAllow) {
      addToWhitelist(
        pending.sessionId,
        pending.request.toolName,
        pending.request.toolInput
      );
    }
    pending.resolve({
      behavior: "allow",
      updatedInput: pending.request.toolInput,
    });
  } else {
    const baseMsg = "用户拒绝了此操作";
    const message = userMessage ? `${baseMsg}：${userMessage}` : baseMsg;
    pending.resolve({ behavior: "deny", message });
  }

  pendingPermissions.delete(requestId);
}

export function answerAskUserQuestion(
  requestId: string,
  answers: Record<string, string>
) {
  const pending = pendingAskUserQuestions.get(requestId);
  if (!pending) {
    logAgentEvent("runtime", "hitl:unknown", "收到未知用户回答", {
      requestId,
    });
    return;
  }

  logAgentEvent("runtime", "hitl:answer", "用户已回答", {
    requestId,
    answerKeys: Object.keys(answers),
  });

  pendingAskUserQuestions.delete(requestId);
  pending.signal.removeEventListener("abort", pending.handleAbort);
  pending.resolve(answers);
  pending.onEvent({ type: "ask_user_resolved", requestId });
}

export function clearAllPending(): void {
  if (pendingPermissions.size > 0 || pendingAskUserQuestions.size > 0) {
    logAgentEvent("runtime", "hitl:cleanup", "清理未完成 HITL 请求", {
      pendingPermissions: pendingPermissions.size,
      pendingAskUserQuestions: pendingAskUserQuestions.size,
    });
  }

  for (const [, p] of pendingPermissions) {
    p.resolve({ behavior: "deny", message: "会话已结束" });
  }
  pendingPermissions.clear();

  for (const [, pending] of pendingAskUserQuestions) {
    pending.signal.removeEventListener("abort", pending.handleAbort);
    pending.reject(new Error("会话已结束"));
  }
  pendingAskUserQuestions.clear();
}
