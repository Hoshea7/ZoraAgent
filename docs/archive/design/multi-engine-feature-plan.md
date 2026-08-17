# Zora 多引擎架构 Feature 方案

> 版本: v1.0 | 日期: 2026-08-05
> 状态: 已对齐，待实施

## 1. 背景与目标

Zora 当前仅支持 Claude Agent SDK 作为唯一运行时，无法接入 OpenAI 协议的模型供应商。本方案通过引入 Pi Agent Runtime (`@earendil-works/pi-*`) 作为第二运行时，实现多引擎架构，让用户可在同一界面内切换使用不同协议的模型。

**核心原则（已确认）**:
- 仅 Agent 模式，不做 Chat 模式
- 设置页不改动，ProviderType 隐式决定协议
- 运行时切换在输入框模型选择器旁提供，不在设置页配置
- 默认 Claude Runtime，Pi 作为第二运行时

**参考项目**: Proma (`/Users/bytedance/Desktop/03-code/github_ref/Proma`)、Pi (`/Users/bytedance/Desktop/03-code/github_ref/pi`)

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    Renderer (React)                  │
│  ChatInput + ModelSelector + RuntimeSelector         │
│  ProviderSettings + RuntimeBadge                     │
└──────────────────────┬──────────────────────────────┘
                       │ IPC
┌──────────────────────▼──────────────────────────────┐
│                    Main Process                      │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │            session-runner.ts                 │    │
│  │   resolve model → lock session              │    │
│  │   → schedule memory agent                   │    │
│  │   → route to runtime                        │    │
│  └──────────┬──────────────────┬───────────────┘    │
│             │                  │                     │
│   ┌─────────▼────────┐  ┌─────▼──────────┐         │
│   │ ClaudeRuntime    │  │ PiRuntime      │         │
│   │ Adapter          │  │ Adapter        │         │
│   │                  │  │                │         │
│   │ 现有 agent.ts    │  │ pi-provider    │         │
│   │ 现有 hitl.ts     │  │ pi-tools       │         │
│   │ 现有 SDK MCP     │  │ pi-mcp-bridge  │         │
│   │                  │  │ pi-permission  │         │
│   │                  │  │ pi-event-mapper│         │
│   │                  │  │ pi-session     │         │
│   │                  │  │ pi-runtime-guard│        │
│   └──────────────────┘  └────────────────┘         │
│             │                  │                     │
│             └──────────┬───────┘                     │
│                   AgentStreamEvent                   │
│                   (统一事件流)                       │
└─────────────────────────────────────────────────────┘
```

**设计思路**: 两个 runtime 并行存在，各自注册自己的工具和适配逻辑，上层通过统一的 `AgentStreamEvent` 事件流和 `RuntimeAdapter` 接口收口。RuntimeRouter 按 session 级别路由到对应 runtime。

---

## 3. 类型定义变更

### 3.1 ProviderType 扩展

**文件**: `src/shared/types/provider.ts`

```typescript
// 新增 "openai" 类型
export type ProviderType =
  | "anthropic"
  | "volcengine"
  | "zhipu"
  | "moonshot"
  | "deepseek"
  | "openai"   // NEW
  | "custom";

// 新增协议类型
export type ProviderProtocol = "anthropic-messages" | "openai-completions";

// ProviderConfig 新增字段
export interface ProviderConfig {
  // ... 现有字段
  protocol?: ProviderProtocol;  // 仅 custom 类型需要显式指定，其他类型隐式推断
}

// PROVIDER_PRESETS 新增 openai
export const PROVIDER_PRESETS = {
  // ... 现有 6 个
  openai: {
    label: "OpenAI",
    defaultUrl: "https://api.openai.com/v1",
  },
};

// 协议映射表
export const PROVIDER_PROTOCOL_MAP: Record<ProviderType, ProviderProtocol> = {
  anthropic: "anthropic-messages",
  volcengine: "anthropic-messages",   // 火山引擎提供 Anthropic 兼容端点
  zhipu: "openai-completions",
  moonshot: "openai-completions",
  deepseek: "openai-completions",
  openai: "openai-completions",
  custom: "openai-completions",       // custom 默认 OpenAI 协议
};

// Runtime 兼容性
export const CLAUDE_COMPATIBLE_TYPES: Set<ProviderType> = new Set([
  "anthropic",
  "volcengine",
]);

export const PI_COMPATIBLE_TYPES: Set<ProviderType> = new Set([
  "openai",
  "zhipu",
  "moonshot",
  "deepseek",
  "custom",
]);

// 兼容性判断 helper
export function getCompatibleRuntimes(type: ProviderType): RuntimeType[] {
  const runtimes: RuntimeType[] = [];
  if (CLAUDE_COMPATIBLE_TYPES.has(type)) runtimes.push("claude");
  if (PI_COMPATIBLE_TYPES.has(type)) runtimes.push("pi");
  return runtimes;
}
```

### 3.2 RuntimeType 与 SessionMeta 扩展

**文件**: `src/shared/zora.d.ts`

```typescript
export type RuntimeType = "claude" | "pi";

export interface SessionMeta {
  // ... 现有字段
  runtimeType?: RuntimeType;       // 会话使用的 runtime，默认 "claude"
  runtimeLocked?: boolean;         // 首条消息后锁定
}
```

### 3.3 RuntimeAdapter 接口

**文件**: `src/main/runtime/types.ts` (新建)

```typescript
export interface RuntimeAdapter {
  readonly type: RuntimeType;

  query(input: RuntimeQueryInput): Promise<RuntimeRunResult>;

  abort(sessionId: string): void;

  interruptQuery?(sessionId: string): Promise<void>;

  dispose(): void;
}

export interface RuntimeQueryInput {
  sessionId: string;
  workspaceId: string;
  prompt: string;
  forwardEvent: (event: AgentStreamEvent) => void;
  attachments?: FileAttachment[];
  permissionMode: PermissionMode;
  providerId: string;
  selectedModelId: string;
  workingDirectory: string;
  sdkSessionId?: string;
  isFirstTurn: boolean;
  source: AgentRunSource;
}

export interface RuntimeRunResult {
  sdkSessionId?: string;
  lateQueuedMessages?: QueuedAgentMessage[];
}
```

---

## 4. 模块设计

### 4.1 RuntimeRouter

**文件**: `src/main/runtime/runtime-router.ts` (新建)

按 session 级别路由到对应 runtime，切换时清理 sdkSessionId。

```typescript
export class RuntimeRouter {
  private adapters: Map<RuntimeType, RuntimeAdapter>;
  private sessionRuntimes: Map<string, RuntimeType>;

  constructor(claudeAdapter: RuntimeAdapter, piAdapter: RuntimeAdapter) {
    this.adapters = new Map([
      ["claude", claudeAdapter],
      ["pi", piAdapter],
    ]);
  }

  getRuntime(sessionId: string): RuntimeType {
    return this.sessionRuntimes.get(sessionId) ?? "claude";
  }

  setRuntime(sessionId: string, type: RuntimeType) {
    const previous = this.sessionRuntimes.get(sessionId);
    if (previous && previous !== type) {
      // 切换 runtime，清理旧 session
      this.adapters.get(previous)?.abort(sessionId);
      // 清理 sdkSessionId 由调用方处理
    }
    this.sessionRuntimes.set(sessionId, type);
  }

  async query(input: RuntimeQueryInput): Promise<RuntimeRunResult> {
    const runtime = this.getRuntime(input.sessionId);
    const adapter = this.adapters.get(runtime);
    if (!adapter) throw new Error(`Unknown runtime: ${runtime}`);
    return adapter.query(input);
  }

  abort(sessionId: string) {
    const runtime = this.getRuntime(sessionId);
    this.adapters.get(runtime)?.abort(sessionId);
  }

  dispose() {
    for (const adapter of this.adapters.values()) {
      adapter.dispose();
    }
  }
}
```

### 4.2 ClaudeRuntimeAdapter

**文件**: `src/main/runtime/claude-adapter.ts` (新建)

封装现有 `agent.ts` 的 `runAgentWithProfile` 逻辑，不改原有代码。

```typescript
export class ClaudeRuntimeAdapter implements RuntimeAdapter {
  readonly type = "claude" as const;

  async query(input: RuntimeQueryInput): Promise<RuntimeRunResult> {
    // 构建 QueryProfile（复用现有 productivity-runner 的逻辑）
    // 调用 runAgentWithProfile()
    // 返回 RuntimeRunResult
  }

  abort(sessionId: string) {
    // 复用现有 abortSession 逻辑
  }

  dispose() {
    // 清理资源
  }
}
```

**关键**: 现有的 `agent.ts`、`hitl.ts`、`productivity-runner.ts`、`session-runner.ts` 基本不改动。ClaudeRuntimeAdapter 是一层薄包装，把现有逻辑封装成 `RuntimeAdapter` 接口。

### 4.3 PiRuntimeAdapter

**文件**: `src/main/runtime/pi-adapter.ts` (新建)

Pi runtime 的核心适配器，整合以下子模块:

#### 4.3.1 Pi Provider Registry

**文件**: `src/main/runtime/pi-provider-registry.ts` (新建)

将 Zora 的 ProviderConfig 注册为 Pi 的 provider，显式声明 `api` 字段。

```typescript
import type { ProviderConfig, ProviderProtocol } from "../../shared/types/provider";

// Zora protocol -> Pi api field
const PROTOCOL_TO_PI_API: Record<ProviderProtocol, string> = {
  "anthropic-messages": "anthropic",
  "openai-completions": "openai",
};

export function buildPiProviderConfig(
  provider: ProviderConfig,
  protocol: ProviderProtocol,
  modelId: string,
) {
  return {
    id: provider.id,
    name: provider.name,
    api: PROTOCOL_TO_PI_API[protocol],
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: modelId,
  };
}
```

**参考**: Proma `pi-model-registry.ts` 的 `normalizePiApi()` 函数。

#### 4.3.2 Pi Tool Registry

**文件**: `src/main/runtime/pi-tool-registry.ts` (新建)

工具注册中心，整合四类工具:

```typescript
export async function buildPiTools(
  sdk: PiSdk,
  cwd: string,
  canUseTool: CanUseToolCallback,
  mcpServerConfigs: McpConfig[],
): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];

  // 1. Pi 内置 7 工具 (read/bash/edit/write/grep/find/ls)
  tools.push(sdk.createReadToolDefinition(cwd));
  tools.push(sdk.createBashToolDefinition(cwd));
  tools.push(sdk.createEditToolDefinition(cwd));
  tools.push(sdk.createWriteToolDefinition(cwd));
  tools.push(sdk.createGrepToolDefinition(cwd));
  tools.push(sdk.createFindToolDefinition(cwd));
  tools.push(sdk.createLsToolDefinition(cwd));

  // 2. Zora 产品工具 (ask_user/todo_write/todo_read)
  tools.push(...buildZoraProductTools(sdk, canUseTool));

  // 3. MCP Bridge Tools (web_search/web_fetch/schedule)
  tools.push(...await buildPiMcpTools(mcpServerConfigs, canUseTool));

  // 4. 全部工具过权限包装
  return tools.map(tool => wrapToolWithPermission(tool, canUseTool));
}
```

#### 4.3.3 Pi Permission Wrapper

**文件**: `src/main/runtime/pi-permission-wrap.ts` (新建)

将 Zora 的 `canUseTool` 回调注入每个 Pi tool，复用现有 `hitl.ts` 的 ask/yolo/smart 三模式。

```typescript
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

// Pi 工具名 -> Claude 工具名归一化
const TOOL_NAME_MAP: Record<string, string> = {
  read: "Read",
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  find: "Glob",
  ls: "LS",
};

// Pi 参数 -> Claude 参数归一化
function normalizeToolInput(toolName: string, input: Record<string, unknown>) {
  if (toolName === "read" && "path" in input) {
    return { ...input, file_path: input.path };
  }
  return input;
}

export function wrapToolWithPermission(
  tool: ToolDefinition,
  canUseTool: (toolName: string, input: Record<string, unknown>, options: unknown) =>
    Promise<{ behavior: "allow" | "deny"; updatedInput?: Record<string, unknown>; message?: string }>,
): ToolDefinition {
  const originalExecute = tool.execute;
  const claudeName = TOOL_NAME_MAP[tool.name] ?? tool.name;

  return {
    ...tool,
    execute: async (input, ctx) => {
      const normalizedInput = normalizeToolInput(tool.name, input);
      const result = await canUseTool(claudeName, normalizedInput, {});
      if (result.behavior === "deny") {
        return { error: result.message ?? "Permission denied" };
      }
      return originalExecute(result.updatedInput ?? input, ctx);
    },
  };
}
```

**参考**: Proma `pi-agent-adapter.ts` 的 `wrapToolWithPermission()`。

#### 4.3.4 Pi MCP Bridge

**文件**: `src/main/runtime/pi-mcp-bridge.ts` (新建)

Pi 没有原生 MCP 客户端，用 `@modelcontextprotocol/sdk` 在主进程连接 MCP server，每个 MCP tool 包装成 Pi `ToolDefinition`。

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { McpConfig } from "../../shared/types/mcp";

class PiMcpClientManager {
  private clients = new Map<string, Client>();

  async connect(config: McpConfig): Promise<Client> {
    const key = JSON.stringify(config);
    if (this.clients.has(key)) return this.clients.get(key)!;

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env,
    });
    const client = new Client({ name: "zora-pi-mcp", version: "1.0" }, { capabilities: {} });
    await client.connect(transport);
    this.clients.set(key, client);
    return client;
  }

  async dispose() {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
  }
}

export async function buildPiMcpTools(
  mcpConfigs: McpConfig[],
  canUseTool: CanUseToolCallback,
): Promise<ToolDefinition[]> {
  const manager = new PiMcpClientManager();
  const tools: ToolDefinition[] = [];

  for (const config of mcpConfigs) {
    const client = await manager.connect(config);
    const { tools: mcpTools } = await client.listTools();

    for (const mcpTool of mcpTools) {
      const toolName = `mcp__${config.name}__${mcpTool.name}`;
      tools.push({
        name: toolName,
        description: mcpTool.description,
        inputSchema: mcpTool.inputSchema,
        execute: async (input) => {
          const result = await client.callTool({ name: mcpTool.name, arguments: input });
          return result;
        },
      });
    }
  }

  return tools;
}
```

**参考**: Proma `pi-mcp-tools.ts` 的 `buildPiMcpTools()` + `PiMcpClientManager`。

#### 4.3.5 Pi Zora Product Tools

**文件**: `src/main/runtime/pi-zora-tools.ts` (新建)

用 Pi 的 `defineTool()` 重写 Zora 专有工具。

```typescript
import { defineTool } from "@earendil-works/pi-coding-agent";

// AskUserQuestion - 使用 Pi extension 的 ctx.ui
export function buildAskUserTool(sdk: PiSdk): ToolDefinition {
  return defineTool(sdk, {
    name: "AskUserQuestion",
    description: "Ask the user a question with options",
    inputSchema: { /* ... */ },
    execute: async (input, ctx) => {
      const { questions } = input as { questions: Question[] };
      const results = [];
      for (const q of questions) {
        if (q.multiSelect) {
          const answer = await ctx.ui.select(q.options.map(o => o.label), { multiple: true });
          results.push(answer);
        } else {
          const answer = await ctx.ui.select(q.options.map(o => o.label));
          results.push(answer);
        }
      }
      return { answers: results };
    },
  });
}

// TodoWrite - JSON 文件读写
export function buildTodoWriteTool(sdk: PiSdk): ToolDefinition {
  return defineTool(sdk, {
    name: "TodoWrite",
    description: "Write todo list",
    inputSchema: { /* ... */ },
    execute: async (input) => {
      const { todos } = input as { todos: TodoItem[] };
      const todoPath = path.join(process.cwd(), ".zora", "todos.json");
      await fs.writeFile(todoPath, JSON.stringify(todos, null, 2));
      return { success: true };
    },
  });
}

// TodoRead
export function buildTodoReadTool(sdk: PiSdk): ToolDefinition {
  return defineTool(sdk, {
    name: "TodoRead",
    description: "Read todo list",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const todoPath = path.join(process.cwd(), ".zora", "todos.json");
      try {
        const content = await fs.readFile(todoPath, "utf-8");
        return { todos: JSON.parse(content) };
      } catch {
        return { todos: [] };
      }
    },
  });
}

export function buildZoraProductTools(sdk: PiSdk): ToolDefinition[] {
  return [
    buildAskUserTool(sdk),
    buildTodoWriteTool(sdk),
    buildTodoReadTool(sdk),
  ];
}
```

#### 4.3.6 Pi Event Mapper

**文件**: `src/main/runtime/pi-event-mapper.ts` (新建)

Pi 的 9 种 `AgentEvent` 转换为 Zora 的 `AgentStreamEvent`。

```typescript
import type { AgentEvent } from "@earendil-works/pi-agent";
import type { AgentStreamEvent } from "../../shared/zora";

// Pi 工具名 -> Claude 工具名
const TOOL_NAME_NORMALIZE: Record<string, string> = {
  read: "Read",
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  find: "Glob",
  ls: "LS",
};

// Pi 参数 -> Claude 参数
function normalizeToolInput(toolName: string, input: Record<string, unknown>) {
  const normalized = { ...input };
  if (toolName === "read" && "path" in normalized) {
    normalized.file_path = normalized.path;
    delete normalized.path;
  }
  return normalized;
}

export function mapPiEventToStreamEvent(
  event: AgentEvent,
  sessionId: string,
): AgentStreamEvent | null {
  switch (event.type) {
    case "message_update":
      // Partial assistant message
      return {
        type: "assistant",
        message: {
          id: `msg-${event.messageId}`,
          role: "assistant",
          content: [{ type: "text", text: event.content }],
        },
        _partial: true,
      };

    case "message_end":
      return {
        type: "assistant",
        message: {
          id: `msg-${event.messageId}`,
          role: "assistant",
          content: [{ type: "text", text: event.content }],
        },
      };

    case "tool_call_start":
      return {
        type: "assistant",
        message: {
          id: `msg-${event.messageId}`,
          role: "assistant",
          content: [{
            type: "tool_use",
            id: event.toolCallId,
            name: TOOL_NAME_NORMALIZE[event.toolName] ?? event.toolName,
            input: normalizeToolInput(event.toolName, event.input),
          }],
        },
      };

    case "tool_execution_end":
      return {
        type: "user",
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: event.toolCallId,
            content: event.result,
          }],
        },
      };

    case "agent_end":
      return {
        type: "result",
        subtype: "success",
        result: event.finalMessage ?? "",
        session_id: sessionId,
      };

    default:
      return null;
  }
}
```

**参考**: Proma `pi-message-adapter.ts` 的 `convertPiMessage()`。

#### 4.3.7 Pi Runtime Guard

**文件**: `src/main/runtime/pi-runtime-guard.ts` (新建)

通过 Pi 的 `shouldStopAfterTurn` 回调实现 maxTurns 控制。

```typescript
export class PiRuntimeGuard {
  private turnCount = 0;
  private maxTurns: number;

  constructor(maxTurns: number) {
    this.maxTurns = maxTurns;
  }

  reset() {
    this.turnCount = 0;
  }

  // 传给 Pi agent session 的 shouldStopAfterTurn 回调
  shouldStopAfterTurn = (): boolean => {
    this.turnCount += 1;
    if (this.turnCount >= this.maxTurns) {
      return true;
    }
    return false;
  };
}
```

**参考**: Proma `agent-runtime-guards.ts` 的 `AgentRuntimeGuard`。

#### 4.3.8 Pi Session Bridge

**文件**: `src/main/runtime/pi-session-bridge.ts` (新建)

管理 Pi 的 JSONL session 文件，映射到 Zora 的 sdkSessionId。

```typescript
import { SessionManager } from "@earendil-works/pi-coding-agent";

const PI_SESSION_DIR = path.join(os.homedir(), ".zora", "pi-sessions");

export class PiSessionBridge {
  async createSession(cwd: string): Promise<{ sessionId: string; sessionFile: string }> {
    await fs.mkdir(PI_SESSION_DIR, { recursive: true });
    const sessionId = randomUUID();
    const sessionFile = path.join(PI_SESSION_DIR, `${sessionId}.jsonl`);
    const session = await SessionManager.open(sessionFile, { cwd });
    return { sessionId, sessionFile };
  }

  async resumeSession(sessionFile: string, cwd: string) {
    return SessionManager.open(sessionFile, { cwd });
  }

  async disposeSession(sessionId: string) {
    // 清理 Pi session 资源
  }
}
```

**参考**: Proma `agent-session-manager.ts`。

#### 4.3.9 Pi Runtime Adapter 主文件

**文件**: `src/main/runtime/pi-adapter.ts` (新建)

```typescript
export class PiRuntimeAdapter implements RuntimeAdapter {
  readonly type = "pi" as const;
  private sessionBridge = new PiSessionBridge();
  private mcpManager = new PiMcpClientManager();
  private activeSessions = new Map<string, { session: AgentSession; guard: PiRuntimeGuard }>();

  async query(input: RuntimeQueryInput): Promise<RuntimeRunResult> {
    // 1. 构建 Pi provider config
    const provider = await getProvider(input.providerId);
    const protocol = resolveProtocol(provider);
    const piProviderConfig = buildPiProviderConfig(provider, protocol, input.selectedModelId);

    // 2. 构建 canUseTool 回调 (复用 hitl.ts)
    const canUseTool = createCanUseTool(input.sessionId, input.permissionMode);

    // 3. 构建工具集
    const mcpConfigs = await loadMcpConfigs();
    const tools = await buildPiTools(sdk, input.workingDirectory, canUseTool, mcpConfigs);

    // 4. 构建/恢复 session
    let session: AgentSession;
    let guard: PiRuntimeGuard;
    if (input.sdkSessionId) {
      // 恢复
      session = await this.sessionBridge.resumeSession(input.sdkSessionId, input.workingDirectory);
      guard = new PiRuntimeGuard(input.maxTurns ?? 120);
    } else {
      // 新建
      const { session: newSession, sessionFile } = await this.sessionBridge.createSession(input.workingDirectory);
      session = newSession;
      guard = new PiRuntimeGuard(input.maxTurns ?? 120);
      this.activeSessions.set(input.sessionId, { session, guard });
    }

    // 5. 注入 system prompt (Zora 的性格/记忆/工作目录)
    const systemPrompt = await buildZoraPrompt(input.prompt, input.workspaceId, input.workingDirectory);

    // 6. 订阅事件
    session.subscribe((event: AgentEvent) => {
      const streamEvent = mapPiEventToStreamEvent(event, input.sessionId);
      if (streamEvent) input.forwardEvent(streamEvent);
    });

    // 7. 运行
    await session.run({
      prompt: input.prompt,
      systemPrompt,
      tools,
      provider: piProviderConfig,
      shouldStopAfterTurn: guard.shouldStopAfterTurn,
    });

    return {
      sdkSessionId: session.sessionId,
    };
  }

  abort(sessionId: string) {
    const active = this.activeSessions.get(sessionId);
    if (active) active.session.abort();
  }

  dispose() {
    this.mcpManager.dispose();
    for (const { session } of this.activeSessions.values()) {
      session.dispose();
    }
    this.activeSessions.clear();
  }
}
```

---

## 5. 执行链路变更

### 5.1 现有链路 (session-runner.ts)

```
resolve model → lock session → save user message
→ schedule memory agent (fire-and-forget, 10min debounce)
→ runProductivitySession()
    → buildRunProfile()
    → runAgentWithProfile() [Claude SDK]
```

### 5.2 新链路

```
resolve model → lock session → save user message
→ schedule memory agent (fire-and-forget)
→ resolve runtime (from session.runtimeType or provider compatibility)
→ runtimeRouter.query()
    ├── ClaudeRuntimeAdapter → 现有 runAgentWithProfile()
    └── PiRuntimeAdapter → Pi agent session.run()
→ forwardEvent (统一 AgentStreamEvent)
```

**变更点**:
- `session-runner.ts` 在 `runProductivitySession` 调用前插入 runtime 路由判断
- `productivity-runner.ts` 的核心逻辑移入 `ClaudeRuntimeAdapter`
- 新增 `PiRuntimeAdapter` 处理 Pi 路径
- 两者通过统一的 `AgentStreamEvent` 输出，UI 层零改动

### 5.3 Memory Agent 适配

Memory Agent (`memory-agent.ts`) 当前直接调 `runAgentWithProfile()`。接入多引擎后:
- Memory Agent 继续走 Claude Runtime（不切 Pi）
- 原因: Memory Agent 使用 Anthropic 协议的 provider，没有切 Pi 的需求
- 如需支持 Pi runtime 的 memory，后续通过 RuntimeRouter 路由即可

---

## 6. 前端变更

### 6.1 RuntimeSelector 组件

**文件**: `src/renderer/components/chat/RuntimeSelector.tsx` (新建)

放在 ModelSelector 旁边，显示当前 runtime 和可选项。

```typescript
interface RuntimeSelectorProps {
  sessionId: string;
  runtimeType: RuntimeType;
  runtimeLocked: boolean;
  compatibleRuntimes: RuntimeType[];
  onRuntimeChange: (type: RuntimeType) => void;
}
```

**行为**:
- 新会话（未锁定）: 可切换 runtime
- 首条消息后: runtimeLocked = true，不可切换
- 切换 runtime 时: 清空 sdkSessionId，提示用户会话历史不跨 runtime
- Provider 不兼容的 runtime 灰显并标注原因

**参考**: Proma `AgentRuntimeSelector` 组件 (`AgentView.tsx:399-460`)。

### 6.2 RuntimeBadge 组件

**文件**: `src/renderer/components/settings/RuntimeBadge.tsx` (新建)

Provider 配置列表上显示支持的 runtime 标识。

```
[Anthropic]  [Claude] [Pi]
[DeepSeek]   [Pi]
[火山引擎]    [Claude] [Pi]
[自定义]      [Pi] (取决于 protocol)
```

**参考**: Proma `AgentCoreChips` 组件 (`ChannelSettings.tsx:320-343`)。

### 6.3 Custom Provider 协议选择

Provider 设置页的 custom 类型新增 protocol 下拉:
- 默认: `openai-completions`
- 可选: `anthropic-messages`

选择 `anthropic-messages` 时，custom provider 也可走 Claude runtime。

### 6.4 ChatInput 集成

**文件**: `src/renderer/components/chat/ChatInput.tsx`

在 ModelSelector 旁添加 RuntimeSelector:

```tsx
<div className="flex items-center gap-2">
  <ModelSelector ... />
  <RuntimeSelector
    sessionId={sessionId}
    runtimeType={session.runtimeType}
    runtimeLocked={session.runtimeLocked}
    compatibleRuntimes={getCompatibleRuntimes(provider.providerType)}
    onRuntimeChange={handleRuntimeChange}
  />
</div>
```

---

## 7. Harness 兼容性矩阵

Pi runtime 下每个 Zora 功能的对等实现:

| 功能 | Claude Runtime | Pi Runtime | 实现方式 |
|------|---------------|------------|---------|
| **文件操作** (Read/Write/Edit) | SDK 内置 | Pi 内置 | `sdk.createReadToolDefinition()` 等 |
| **Bash** | SDK 内置 | Pi 内置 | `sdk.createBashToolDefinition()` |
| **Grep/Glob/LS** | SDK 内置 | Pi 内置 | `sdk.create*ToolDefinition()` |
| **MCP 工具** | SDK `mcpServers` | 进程内连接 | `pi-mcp-bridge.ts` |
| **web_search** | MCP server | Pi custom tool | MCP Bridge |
| **web_fetch** | MCP server | Pi custom tool | MCP Bridge |
| **schedule** | MCP server | Pi custom tool | MCP Bridge |
| **权限 (HITL)** | `canUseTool` SDK 回调 | wrapper 注入 | `pi-permission-wrap.ts` |
| **AskUserQuestion** | SDK 内置工具 | Pi custom tool | `pi-zora-tools.ts` |
| **TodoWrite/Read** | SDK 内置工具 | Pi custom tool | `pi-zora-tools.ts` |
| **maxTurns** | SDK options | `shouldStopAfterTurn` | `pi-runtime-guard.ts` |
| **System Prompt** | SDK options | `appendSystemPrompt` | 直接注入 |
| **Skills** | `~/.zora/skills/` | Pi skill discovery | 路径配置，零开发 |
| **Session 持久化** | sdkSessionId | JSONL session | `pi-session-bridge.ts` |
| **事件流** | SDK SDKMessage | AgentEvent 转换 | `pi-event-mapper.ts` |
| **NotebookEdit** | SDK 内置 | 暂不支持 | Phase 3 |
| **Agent (子agent)** | SDK 内置 | Pi extension | Phase 3 |
| **EnterPlanMode** | SDK 内置 | Pi custom tool | Phase 3 |
| **Worktree** | SDK 内置 | 暂不支持 | 后续评估 |

---

## 8. 实施计划

### Phase 1: 基础链路打通 (MVP)

**目标**: Pi runtime 下能跑通基本 agent 对话，验证多模型链路

| 序号 | 任务 | 涉及文件 |
|------|------|---------|
| 1.1 | 类型定义扩展 | `src/shared/types/provider.ts`, `src/shared/zora.d.ts` |
| 1.2 | RuntimeAdapter 接口定义 | `src/main/runtime/types.ts` |
| 1.3 | ClaudeRuntimeAdapter (包装现有代码) | `src/main/runtime/claude-adapter.ts` |
| 1.4 | RuntimeRouter | `src/main/runtime/runtime-router.ts` |
| 1.5 | Pi Provider Registry | `src/main/runtime/pi-provider-registry.ts` |
| 1.6 | Pi Event Mapper | `src/main/runtime/pi-event-mapper.ts` |
| 1.7 | Pi Session Bridge | `src/main/runtime/pi-session-bridge.ts` |
| 1.8 | Pi Runtime Guard (maxTurns) | `src/main/runtime/pi-runtime-guard.ts` |
| 1.9 | PiRuntimeAdapter (整合 1.5-1.8) | `src/main/runtime/pi-adapter.ts` |
| 1.10 | session-runner.ts 接入 RuntimeRouter | `src/main/session-runner.ts` |
| 1.11 | RuntimeSelector 组件 | `src/renderer/components/chat/RuntimeSelector.tsx` |
| 1.12 | ChatInput 集成 RuntimeSelector | `src/renderer/components/chat/ChatInput.tsx` |
| 1.13 | Provider 设置新增 openai 类型 + custom protocol | `src/renderer/components/settings/` |

**Phase 1 结束时**: 用户可在输入框切换 Claude / Pi runtime，Pi 下用 OpenAI 协议模型跑基本对话，有 7 个基础工具，有 maxTurns 控制。无 MCP、无 HITL、无 TodoWrite，功能残缺但链路验证通过。

### Phase 2: Harness 补齐

**目标**: Pi runtime 下功能与 Claude runtime 对等

| 序号 | 任务 | 涉及文件 |
|------|------|---------|
| 2.1 | Pi Permission Wrapper | `src/main/runtime/pi-permission-wrap.ts` |
| 2.2 | Pi MCP Bridge | `src/main/runtime/pi-mcp-bridge.ts` |
| 2.3 | Pi Zora Product Tools (ask_user/todo) | `src/main/runtime/pi-zora-tools.ts` |
| 2.4 | Pi Tool Registry (整合所有工具) | `src/main/runtime/pi-tool-registry.ts` |
| 2.5 | RuntimeBadge 组件 | `src/renderer/components/settings/RuntimeBadge.tsx` |
| 2.6 | Custom Provider protocol 选择 UI | `src/renderer/components/settings/` |
| 2.7 | 联调测试 (MCP + HITL + Todo 全链路) | - |

**Phase 2 结束时**: Pi runtime 下有 MCP（web_search/web_fetch/schedule）、有权限（ask/yolo/smart）、有 AskUserQuestion、有 TodoWrite，和 Claude runtime 功能对等。

### Phase 3: 体验优化

| 序号 | 任务 | 说明 |
|------|------|------|
| 3.1 | Partial message 节流 | Pi 每次 delta 发完整消息，50ms 节流防 IPC 风暴 |
| 3.2 | Session rewind | Pi JSONL 支持 fork/rewind，映射到 Zora session |
| 3.3 | Compaction | Pi 原生 `session.compact()`，比 Claude SDK 更可控 |
| 3.4 | EnterPlanMode/ExitPlanMode | 用 Pi custom tool 实现 |
| 3.5 | 子 Agent | 用 Pi extension 的 subagent 能力实现 |
| 3.6 | Provider 扩展 | 可选接入 Google、AWS Bedrock 等 |

---

## 9. 依赖项

```json
{
  "dependencies": {
    "@earendil-works/pi-ai": "latest",
    "@earendil-works/pi-agent": "latest",
    "@earendil-works/pi-coding-agent": "latest",
    "@modelcontextprotocol/sdk": "latest"
  }
}
```

Pi 包来源: `/Users/bytedance/Desktop/03-code/github_ref/pi` (本地 link 或 publish 后 npm install)

---

## 10. 风险与约束

| 风险 | 影响 | 缓解 |
|------|------|------|
| Pi SDK API 变更 | adapter 代码需要跟进 | Pi 还在快速发展，锁定版本 |
| MCP 连接稳定性 | Pi runtime 下 MCP 工具不可用 | 连接池 + 自动重连 |
| Pi 工具行为差异 | 和 Claude SDK 工具行为不完全一致 | 逐工具测试，归一化层处理差异 |
| Session 跨 runtime 不兼容 | 切 runtime 后历史丢失 | UI 提示 + sdkSessionId 清理 |
| Memory Agent 硬编码 Claude | 暂只走 Claude runtime | 后续通过 RuntimeRouter 统一路由 |

---

## 11. 现有文件改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/shared/types/provider.ts` | 修改 | 新增 openai 类型、ProviderProtocol、兼容性判断 |
| `src/shared/zora.d.ts` | 修改 | SessionMeta 新增 runtimeType/runtimeLocked |
| `src/main/session-runner.ts` | 修改 | 插入 RuntimeRouter 路由逻辑 |
| `src/main/productivity-runner.ts` | 小改 | 抽取 buildRunProfile 供 ClaudeAdapter 复用 |
| `src/renderer/components/chat/ChatInput.tsx` | 修改 | 集成 RuntimeSelector |
| `src/renderer/components/chat/ModelSelector.tsx` | 小改 | runtime 变化时刷新可选模型 |
| `src/renderer/components/settings/*` | 修改 | 新增 openai provider、custom protocol 选择 |

**不改动的文件**:
- `src/main/agent.ts` - ClaudeRuntimeAdapter 包装它，不改内部
- `src/main/hitl.ts` - PiRuntimeAdapter 通过 wrapper 复用它
- `src/main/memory-agent.ts` - 继续走 Claude runtime
- `src/main/provider-manager.ts` - 不改，新增 openai 类型只需加 preset

---

## 12. 新增文件清单

| 文件 | 说明 |
|------|------|
| `src/main/runtime/types.ts` | RuntimeAdapter 接口定义 |
| `src/main/runtime/runtime-router.ts` | per-session runtime 路由 |
| `src/main/runtime/claude-adapter.ts` | Claude runtime 适配器 |
| `src/main/runtime/pi-adapter.ts` | Pi runtime 适配器主文件 |
| `src/main/runtime/pi-provider-registry.ts` | Provider -> Pi 注册 |
| `src/main/runtime/pi-tool-registry.ts` | 工具注册中心 |
| `src/main/runtime/pi-permission-wrap.ts` | canUseTool 注入层 |
| `src/main/runtime/pi-mcp-bridge.ts` | MCP -> Pi tools 桥接 |
| `src/main/runtime/pi-zora-tools.ts` | Zora 专有工具重写 |
| `src/main/runtime/pi-event-mapper.ts` | Pi events -> AgentStreamEvent |
| `src/main/runtime/pi-session-bridge.ts` | JSONL session 管理 |
| `src/main/runtime/pi-runtime-guard.ts` | maxTurns 控制 |
| `src/renderer/components/chat/RuntimeSelector.tsx` | Runtime 选择器 |
| `src/renderer/components/settings/RuntimeBadge.tsx` | 兼容性标识 |
