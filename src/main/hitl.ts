import type {
  AgentStreamEvent,
  AskUserQuestion,
  AskUserRequest,
  PermissionMode,
  PermissionRequest,
} from "../shared/zora";

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
};

type PendingAskUser = {
  resolve: (result: PermissionResult) => void;
  request: AskUserRequest;
};

type JsonRecord = Record<string, unknown>;
type AgentEventForwarder = (event: AgentStreamEvent) => void;

const pendingPermissions = new Map<string, PendingPermission>();
const pendingAskUsers = new Map<string, PendingAskUser>();

let currentPermissionMode: PermissionMode = "ask";

const SAFE_TOOLS = new Set([
  "Read", "Glob", "Grep", "WebSearch", "WebFetch",
  "TodoRead", "TodoWrite", "TaskOutput",
  "ListMcpResources", "ReadMcpResource", "ExitPlanMode",
]);

const SMART_AUTO_ALLOW_TOOLS = new Set([
  "Write", "Edit", "MultiEdit", "NotebookEdit",
  "Agent",
  "Task", "TaskStop",
]);

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

function isSafeBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (/[|;&]|>{1,2}|\$\(|`/.test(trimmed)) {
    return false;
  }
  return SAFE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isReadOnlyTool(toolName: string, input: Record<string, unknown>): boolean {
  if (SAFE_TOOLS.has(toolName)) {
    return true;
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

function parseAskUserQuestions(input: Record<string, unknown>): AskUserQuestion[] {
  if (typeof input.question === "string") {
    return [{ question: input.question }];
  }

  if (Array.isArray(input.questions)) {
    return input.questions.map((q: unknown) => {
      if (typeof q === "string") {
        return { question: q };
      }

      if (isRecord(q) && typeof q.question === "string") {
        return {
          question: q.question,
          options: Array.isArray(q.options) ? q.options : undefined,
        };
      }

      return { question: stringifyContent(q) };
    });
  }

  return [{ question: stringifyContent(input) }];
}

export function getPermissionMode(): PermissionMode {
  return currentPermissionMode;
}

export function setPermissionMode(mode: PermissionMode) {
  currentPermissionMode = mode;
}

export function createCanUseTool(onEvent: AgentEventForwarder) {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions
  ): Promise<PermissionResult> => {
    const allow = (): PermissionResult => ({
      behavior: "allow",
      updatedInput: input,
    });

    if (toolName === "AskUserQuestion") {
      const requestId = crypto.randomUUID();
      const request: AskUserRequest = {
        requestId,
        questions: parseAskUserQuestions(input),
        toolInput: input,
      };
      onEvent({ type: "ask_user_request", request });

      return new Promise<PermissionResult>((resolve) => {
        pendingAskUsers.set(requestId, { resolve, request });

        const handleAbort = () => {
          if (pendingAskUsers.has(requestId)) {
            pendingAskUsers.delete(requestId);
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

    if (options.signal.aborted) {
      return { behavior: "deny", message: "操作已中止" };
    }

    if (options.agentID) {
      return allow();
    }

    if (isReadOnlyTool(toolName, input)) {
      return allow();
    }

    if (currentPermissionMode === "yolo") {
      return allow();
    }

    if (
      currentPermissionMode === "smart" &&
      SMART_AUTO_ALLOW_TOOLS.has(toolName)
    ) {
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
    onEvent({ type: "permission_request", request });

    return new Promise<PermissionResult>((resolve) => {
      pendingPermissions.set(requestId, { resolve, request });

      const handleAbort = () => {
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
  };
}

export function respondToPermission(
  requestId: string,
  behavior: "allow" | "deny",
  _alwaysAllow: boolean,
  userMessage?: string
) {
  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    return;
  }

  if (behavior === "allow") {
    pending.resolve({ behavior: "allow", updatedInput: pending.request.toolInput });
  } else {
    const baseMsg = "用户拒绝了此操作";
    const message = userMessage ? `${baseMsg}：${userMessage}` : baseMsg;
    pending.resolve({ behavior: "deny", message });
  }

  pendingPermissions.delete(requestId);
}

export function respondToAskUser(
  requestId: string,
  answers: Record<string, string>
) {
  const pending = pendingAskUsers.get(requestId);
  if (!pending) {
    return;
  }

  pending.resolve({
    behavior: "allow",
    updatedInput: { ...pending.request.toolInput, answers },
  });
  pendingAskUsers.delete(requestId);
}

export function clearAllPending(): void {
  for (const [, p] of pendingPermissions) {
    p.resolve({ behavior: "deny", message: "会话已结束" });
  }
  pendingPermissions.clear();

  for (const [, p] of pendingAskUsers) {
    p.resolve({ behavior: "deny", message: "会话已结束" });
  }
  pendingAskUsers.clear();
}
