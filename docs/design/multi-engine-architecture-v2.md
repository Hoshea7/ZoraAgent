# 多引擎架构分层方案 v2

## 一、命名修正：为什么不用"Harness Layer"

Claude Agent SDK 本身是一个 Harness（agent loop + tool 执行 + session 管理 + compaction）。Pi 的 `AgentHarness` 类字面意义上就是一个 Harness。我们中间这层不做 Harness 的事，它做的是翻译和桥接。

**正确的三层定义：**

| 层 | 名称                    | 是什么                     | 类比   |
| - | --------------------- | ----------------------- | ---- |
| 1 | Product Layer         | Zora 的产品逻辑，runtime 无关   | 操作系统 |
| 2 | Runtime Adapter Layer | 把产品意图翻译成 runtime 能消费的格式 | 设备驱动 |
| 3 | Runtime Layer         | 实际执行 agent loop 的引擎     | 硬件   |

`AgentHarnessSpec` 是层 1 给层 2 的输入契约，它本身不是一个层。更准确的叫法是 **AgentRunSpec**（执行规格），后面统一用这个名字。

***

## 二、每层的精确定义

### Layer 1: Product Layer

**身份**：Zora 的产品大脑，决定"做什么"，不关心"怎么做"。

**Scope**：

- 会话管理（创建、删除、fork、归档）
- 消息持久化（Zora session store 是唯一真相源）
- Provider 管理（API key、baseUrl、模型选择）
- MCP server 配置
- Skills 目录路径
- 权限规则（HITL 策略）
- 记忆触发
- 附件文件读取
- 动态上下文构建（workspace 信息、时间、记忆注入）

**包含的模块**：

```
agent-execution-service.ts     -- 编排入口
agent-profiles/                 -- 构建 AgentRunSpec
  productivity-profile.ts       -- 加载消息、构建上下文
  types.ts                      -- AgentRunSpec 定义
hitl.ts                         -- 权限决策（runtime 无关）
session-store.ts                -- 会话持久化
session-fork.ts                 -- Fork 策略入口
provider-manager.ts             -- Provider 配置
mcp-manager.ts                  -- MCP server 管理
memory-agent.ts                 -- 记忆触发
attachment-handler.ts           -- 附件读取解析
```

**与下游的交互**：

- 产出 `AgentRunSpec`（执行规格）+ `RuntimeExecutionTarget`（目标 runtime 信息）
- 通过 `RuntimeAdapter.start(input)` 传递
- 接收 `AgentStreamEvent`（归一化事件）通过 `forwardEvent` 回调
- 在 run 完成后触发 memory hook

**目标**：新增一个 Runtime 时，Product Layer 零改动。

***

### Layer 2: Runtime Adapter Layer

**身份**：翻译层，把产品意图翻译成特定 runtime 能消费的格式。

**Scope**：

- 把 `AgentRunSpec` 翻译成 runtime-specific 的配置（Claude SDK Options / Pi AgentHarness config）
- 把 MCP server 配置翻译成 runtime-specific 的工具注入方式
- 把 Skills 目录翻译成 runtime-specific 的加载方式
- 把 attachments 翻译成 runtime-specific 的消息格式
- 把 runtime 产出的事件翻译成统一的 `AgentStreamEvent`
- 管理 run 生命周期（start/stop/queue）

**不做的事**：

- 不决定"有哪些工具"（由 Product Layer 决定）
- 不决定"有哪些 skills"（由 Product Layer 决定）
- 不决定"权限规则是什么"（由 Product Layer 的 hitl.ts 决定）
- 不持久化消息（由 Product Layer 的 session-store 持久化）
- 不触发记忆（由 Product Layer 的 ExecutionService 触发）

**包含的模块**：

```
runtime/
  types.ts                       -- RuntimeAdapter 接口 + AgentRunSpec 输入类型
  runtime-router.ts              -- 分发到对应 adapter
  runtime-execution-target.ts    -- 解析 runtime 目标信息

  claude-adapter.ts              -- Claude 路径入口
  claude-model-config.ts         -- reasoning level 翻译

  pi-adapter.ts                  -- Pi 路径入口
  pi-session-bridge.ts           -- Pi session 管理（将升级）
  pi-conversation.ts             -- Zora 消息 -> Pi 消息投影
  pi-event-mapper.ts             -- Pi 事件 -> AgentStreamEvent
  pi-tools.ts                    -- Pi 工具组装
  pi-mcp-bridge.ts               -- MCP 工具包装（新增）
  pi-runtime-guard.ts            -- turn 限制
  pi-provider-registry.ts        -- Provider 配置翻译
```

**与上游的交互**：

- 接收 `AgentRunSpec` + `RuntimeExecutionTarget` + `forwardEvent`
- 返回 `RuntimeRunHandle`（completion promise + abort + enqueue）

**与下游的交互**：

- 调用 runtime 的 API（Claude SDK `query()` / Pi `AgentHarness.prompt()`）
- 订阅 runtime 事件，翻译后通过 `forwardEvent` 上报

**目标**：新增一个 Runtime 时，只写一个新 Adapter 文件，不修改 Product Layer 和其他 Adapter。

***

### Layer 3: Runtime Layer

**身份**：实际执行 agent loop 的引擎。

**Claude Agent SDK**：

- `query()` 发起 agent loop
- 内置 tool 执行（Bash/Edit/Read/Write/Grep/Glob/TodoWrite/AskUser）
- 内置 session 管理（sdkSessionId、transcript 文件）
- 内置 context compaction（compact\_boundary）
- 通过 plugin 加载 skills
- 通过 mcpServers 配置注入 MCP 工具
- 通过 canUseTool 回调实现 HITL

**Pi Agent Core（pi-agent-core）**：

- `AgentHarness` 类：session 树 + compaction + skills + provider hooks
- `Agent` 类：有状态 agent loop（queueing、lifecycle events）
- `runAgentLoop()`：无状态函数（当前使用方式）
- `Session` 类：可插拔存储（JSONL / Memory）
- `loadSkills()` / `formatSkillsForSystemPrompt()`：skills 加载
- `compact()` / `shouldCompact()`：context 压缩
- `NodeExecutionEnv`：Node.js 文件系统 + shell

**Pi Coding Agent（pi-coding-agent）**：

- `AgentSession` 类：wraps `Agent`（不是 `AgentHarness`），加 auto-compaction、auto-retry、model registry
- `SessionManager`：JSONL 文件 session 管理
- `createCodingTools()`：7 个 coding tools（read/bash/edit/write/grep/find/ls）
- Extension 系统
- Settings 管理

**目标**：被 Adapter 调用，执行 agent loop，产出事件。

***

## 三、Pi 包关系与升级策略

### 当前状态

Pi adapter 用 `runAgentLoop()`（Layer 1，最低层），手动在 `PiSessionBridge` 里管理 messages 数组、turn guard、abort。等于自己用低层积木搭了一个简陋版 harness，但缺了 compaction、skills、session 管理等能力。

### Pi 的四层抽象

```
Layer 4: AgentSession (pi-coding-agent)  -- 全栈，含 ModelRuntime/SessionManager/Settings
Layer 3: AgentHarness (pi-agent-core)    -- session + compaction + skills + hooks
Layer 2: Agent (pi-agent-core)           -- 有状态 loop，queueing，lifecycle
Layer 1: runAgentLoop (pi-agent-core)    -- 无状态函数 ← 当前在这里
```

关键发现：**AgentSession wraps Agent，不是 AgentHarness**。两者是平行设计：

- `AgentHarness`：你自带 Models/Session/ExecutionEnv，灵活度高
- `AgentSession`：全栈方案，含 ModelRuntime/SessionManager/SettingsManager

### 升级决策：选 AgentHarness，不选 AgentSession

**理由**：

| 维度          | AgentHarness                                     | AgentSession                               |
| ----------- | ------------------------------------------------ | ------------------------------------------ |
| Session 管理  | 可插拔（Memory/JSONL），Zora 可自带                       | 绑定 SessionManager（JSONL 文件）                |
| Provider 管理 | 自带 Models，Zora 已有 provider-manager               | 绑定 ModelRuntime（含 OAuth/credential）        |
| Skills      | `loadSkills()` + `formatSkillsForSystemPrompt()` | `loadSkills()` + `formatSkillsForPrompt()` |
| Compaction  | 手动触发 + hooks                                     | auto-compaction                            |
| Tools       | 需自己组装（可从 pi-coding-agent 导入）                     | 内置 7 个 coding tools                        |
| 依赖          | 只需 pi-agent-core                                 | 需要 pi-coding-agent（更重）                     |
| 控制          | 高                                                | 低（opinionated）                             |

Zora 已经有自己的 session store 和 provider manager，用 AgentSession 会和这些冲突。AgentHarness 给我们 compaction + skills + hooks，同时保持对 session 和 provider 的控制权。

Coding tools 从 pi-coding-agent 单独导入（`createCodingTools(cwd)` 返回 `AgentTool[]`），不需要用 AgentSession 的全栈。

### 升级后的 Pi 架构

```
PiRuntimeAdapter
  └── PiSessionBridge
        └── AgentHarness (pi-agent-core)
              ├── Session (MemorySessionStorage, Zora owns persistence)
              ├── Models (from Zora provider config)
              ├── Tools: createCodingTools(cwd) + MCP bridge + Todo + AskUser
              ├── Skills: loadSkills(getZoraPluginPath())
              ├── NodeExecutionEnv
              └── Compaction: auto via hooks
```

***

## 四、时序图

### 正常对话流程

```
User          UI           ExecutionService    ProductivityProfile    RuntimeRouter    Adapter         Runtime
 │             │                   │                    │                   │              │               │
 │─ msg ──────>│                   │                    │                   │              │               │
 │             │─ execute() ──────>│                    │                   │              │               │
 │             │                   │─ prepare() ───────>│                   │              │               │
 │             │                   │                    │─ loadMessages()   │              │               │
 │             │                   │                    │─ buildContext()   │              │               │
 │             │                   │<── AgentRunSpec ───│                   │              │               │
 │             │                   │                    │                   │              │               │
 │             │                   │─ resolveTarget() ──────────────────────────────────────>│               │
 │             │                   │<── RuntimeExecutionTarget ─────────────────────────────│               │
 │             │                   │                    │                   │              │               │
 │             │                   │─ start(spec, target, forwardEvent) ──>│              │               │
 │             │                   │                    │                   │─ dispatch ──>│               │
 │             │                   │                    │                   │              │               │
 │             │                   │                    │                   │              │─ translate spec
 │             │                   │                    │                   │              │  (MCP/Skills/
 │             │                   │                    │                   │              │   Attachments)
 │             │                   │                    │                   │              │               │
 │             │                   │                    │                   │              │─ start() ────>│
 │             │                   │                    │                   │              │               │─ agent loop
 │             │                   │                    │                   │              │               │─ tool calls
 │             │                   │                    │                   │              │<── events ────│
 │             │                   │                    │                   │              │               │
 │             │                   │<──── forwardEvent ─────────────────────────────────────│               │
 │             │<── stream ────────│                    │                   │              │               │
 │<── render ──│                   │                    │                   │              │               │
 │             │                   │                    │                   │              │               │
 │             │                   │                ┌───│                   │              │               │
 │             │                   │  finally:      │   │                   │              │               │
 │             │                   │  onConvEnd() ───┘   │                   │              │               │
 │             │                   │                    │                   │              │               │
 │             │                   │<── completion ─────│───────────────────│──────────────│               │
```

### Fork 流程

```
User    UI    session-fork.ts              session-store.ts     Claude SDK
 │       │          │                            │                    │
 │─ fork ──────────>│                            │                    │
 │       │          │─ getSessionMeta() ───────>│                    │
 │       │          │<── session {runtimeType} ──│                    │
 │       │          │                            │                    │
 │       │          │── [runtimeType === "claude"] ───────────────────>│
 │       │          │                            │   forkSdkSession() │
 │       │          │                            │   copy transcript  │
 │       │          │<── forked SDK session ───────────────────────── │
 │       │          │                            │                    │
 │       │          │── [runtimeType === "pi"]   │                    │
 │       │          │   forkPiSession():         │                    │
 │       │          │   - copy Zora messages     │                    │
 │       │          │   - copy working dir       │                    │
 │       │          │   - no SDK fork needed     │                    │
 │       │          │<── new session ────────────│                    │
 │       │          │                            │                    │
 │       │<── result │                            │                    │
 │<── UI update ───│                             │                    │
```

### MCP 工具调用流程（Pi 路径）

```
Agent    AgentHarness    PiRuntimeAdapter    McpManager    MCP Server
 │           │                  │                  │             │
 │─ call ───>│                  │                  │             │
 │  web_search│                  │                  │             │
 │           │─ execute ───────>│                  │             │
 │           │                  │─ callTool() ────>│             │
 │           │                  │                  │─ MCP ──────>│
 │           │                  │                  │<── result ──│
 │           │                  │<── result ───────│             │
 │           │<── result ───────│                  │             │
 │<── result │                  │                  │             │
```

***

## 五、AgentRunSpec 定义（修正命名）

```typescript
// 替代原 AgentHarnessSpec，但保持字段不变，只是改名
interface AgentRunSpec {
  profileId: AgentProfileId;
  sessionId: string;
  workspaceId: string;
  prompt: {
    user: string;
    dynamicContext: string;
    system: string;          // 基础 system prompt，Adapter 可追加 runtime 特定内容
  };
  conversation: {
    messages: ConversationMessage[];
    persistence: "durable" | "ephemeral";
  };
  workspace: { cwd: string };
  permissions: { mode: "interactive" | "unattended" };
  limits: {
    maxTurns: number;
    maxOutputTokens: number;
    reasoningLevel: ReasoningLevel;
  };
  output: { incremental: boolean; visible: boolean };
}
```

Adapter 接收 `AgentRunSpec` + `RuntimeExecutionTarget` + `forwardEvent` + `attachments`，产出 `RuntimeRunHandle`。

**重命名范围**：`AgentHarnessSpec` -> `AgentRunSpec`，`HarnessLimits` -> `RunLimits`。纯重命名，不改字段和逻辑。代码里全局替换即可。

***

## 六、缺失能力清单（保留，修正分层描述）

### P0

| # | 能力        | 根因                            | 方案                                       | 层                       |
| - | --------- | ----------------------------- | ---------------------------------------- | ----------------------- |
| 1 | Fork 分流   | session-fork.ts 绑死 Claude SDK | 按 runtimeType 分流，Pi 走数据层复制               | Product                 |
| 2 | MCP 注入    | Pi 只有 6 个硬编码 tools            | McpManager 产出配置，Pi adapter 包装成 AgentTool | Product 产出 + Adapter 翻译 |
| 3 | Memory 触发 | onConversationEnd 只在 agent.ts | 移到 ExecutionService finally 块            | Product                 |

### P1

| # | 能力            | 根因              | 方案                                                        | 层       |
| - | ------------- | --------------- | --------------------------------------------------------- | ------- |
| 4 | Skills        | Pi 无加载机制        | AgentHarness.loadSkills() + formatSkillsForSystemPrompt() | Adapter |
| 5 | Attachments   | Pi adapter 忽略字段 | 图片转 ImageContent，文本拼入 user message                        | Adapter |
| 6 | Todo          | Pi 无 todo 工具    | 自定义 AgentTool，对齐 Claude 数据格式                              | Adapter |
| 7 | Compaction    | Pi 无上下文压缩       | AgentHarness 内置 compaction，通过 hooks 启用                    | Runtime |
| 8 | System Prompt | Pi 直接透传         | Adapter 追加 skills 内容 + 工具能力声明                             | Adapter |

### P2

| #  | 能力          | 根因                  | 方案                                                          | 层       |
| -- | ----------- | ------------------- | ----------------------------------------------------------- | ------- |
| 9  | AskUser     | Pi 无此工具             | 自定义 AgentTool，通过 forwardEvent 发事件                           | Adapter |
| 10 | Usage       | Pi event mapper 没映射 | message\_end 时提取 usage                                      | Adapter |
| 11 | Session 持久化 | Pi session 全在内存     | MemorySessionStorage + Zora 持久化（已有），AgentHarness 的 JSONL 可选 | Runtime |
| 12 | Subtask     | Pi 无子任务             | 暂不做                                                         | -       |

***

## 七、实施切片

### 切片 0：命名修正 + Memory Hook（前置）

**目标**：把命名对齐，把 memory trigger 移到正确位置。

**改动**：

- `AgentHarnessSpec` -> `AgentRunSpec`，`HarnessLimits` -> `RunLimits`（全局替换）
- `onConversationEnd()` 从 `agent.ts` 移到 `AgentExecutionService.execute()` finally 块
- `session-fork.ts` 新增 `forkPiSession()`，按 runtimeType 分流

**验证**：

- TypeScript 编译通过，所有测试通过
- Pi 会话 fork 不报错
- Pi 会话结束后记忆日志触发

### 切片 1：Pi 升级到 AgentHarness

**目标**：把 PiSessionBridge 从 runAgentLoop 升级到 AgentHarness，获得 compaction + skills + hooks 基础。

**改动**：

- `pi-session-bridge.ts`：内部用 `AgentHarness` 替代手写 `PiAgentSession`
- `Session`：用 `MemorySessionStorage`（Zora owns persistence）
- `Models`：从 Zora provider config 构建
- `NodeExecutionEnv`：用于 coding tools
- Tools：继续用 `createCodingTools(cwd)` + 后续切片新增的工具

**验证**：

- Pi 会话正常对话
- 长对话触发 compaction，不撞 context window
- Skills 能加载（通过 `loadSkills(getZoraPluginPath())`）

### 切片 2：MCP 工具桥接

**目标**：Pi 会话能使用所有 MCP 工具。

**改动**：

- 新增 `pi-mcp-bridge.ts`：把 MCP tool 定义包装成 `AgentTool`
- `mcp-manager.ts`：新增 `getMcpToolDefinitions()` 方法
- `pi-adapter.ts`：合并 coding tools + MCP tools

**验证**：

- Pi 会话能调用 web\_search、web\_fetch、schedule
- HITL 权限检查正常

### 切片 3：Attachments + Todo + System Prompt

**目标**：补齐体验层能力。

**改动**：

- `pi-adapter.ts`：处理 attachments（图片转 ImageContent）
- 新增 `pi-todo-tool.ts`：TodoWrite/TodoRead 作为 AgentTool
- 构建 Pi system prompt builder（追加 skills + 工具声明）
- `pi-event-mapper.ts`：映射 usage + todo 事件

**验证**：

- Pi 会话图片附件可用
- Todo 创建后前端展示
- System prompt 包含 skills 内容
- Usage 展示正确

### 切片 4：AskUser + 清理

**目标**：补齐最后一个交互工具，然后清理冗余代码。

**改动**：

- 自定义 AskUserQuestion AgentTool
- 审视所有代码，删除冗余/兜底
- 确保两个 adapter 的行为一致性

**验证**：

- Pi 会话能向用户提问
- 两个 runtime 的功能对齐

***

## 八、依赖关系

```
切片0 (命名+Memory+Fork) ─── 前置，必须先做
    │
    ├──> 切片1 (AgentHarness升级) ─── 后续切片的基础
    │        │
    │        ├──> 切片2 (MCP桥接)
    │        │
    │        └──> 切片3 (Attach+Todo+SysPrompt)
    │                 │
    │                 └──> 切片4 (AskUser+清理)
```

切片 0 是前置（命名对齐 + 基础修复）。切片 1 是核心（升级到 AgentHarness）。切片 2 和 3 可以在 1 之后并行。切片 4 收尾。
