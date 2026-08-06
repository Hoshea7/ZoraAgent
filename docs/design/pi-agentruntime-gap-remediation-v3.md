# Pi AgentRuntime 能力补齐方案 v3

> 前序文档：`pi-harness-gap-remediation.md` (v1) 和 `multi-engine-architecture-v2.md` (v2) 已被本文档取代。

## 一、验证结论

通过验证脚本确认 AgentSession（pi-coding-agent 0.82.1）完全兼容 Zora 的 provider 配置：

- 自定义 provider（火山引擎 Ark, anthropic-messages 协议）注册成功
- In-memory SessionManager / SettingsManager 无文件 I/O，符合 Zora 自管持久化的需求
- 事件类型完整：agent_start / turn_start / message_start / message_update / message_end / tool_execution_start/end / turn_end / agent_end / agent_settled
- Coding tools（read/bash/edit/write）正常执行
- message_end 事件携带 usage 数据（input/output/cache tokens + cost）
- followUp（排队消息）正常工作
- 事件格式可直接映射到 Zora 的 AgentStreamEvent

结论：**使用 AgentSession 作为 Pi AgentRuntime 的执行核心，放弃 AgentHarness 方案。**

---

## 二、命名规范

### 全局命名变更

| 旧名 | 新名 | 说明 |
| - | --- | --- |
| Runtime | AgentRuntime | 概念名，更准确 |
| RuntimeType | AgentRuntimeType | 枚举类型 |
| RuntimeAdapter | AgentRuntimeAdapter | 接口名 |
| RuntimeStartInput | AgentRuntimeInput | start() 入参 |
| RuntimeRunHandle | AgentRuntimeHandle | start() 返回值 |
| RuntimeExecutionTarget | AgentRuntimeTarget | 解析后的目标信息 |
| RuntimeNotAvailableError | AgentRuntimeNotAvailableError | 错误类 |
| AgentHarnessSpec | AgentRequest | 产品层给 Adapter 的请求 |
| HarnessLimits | RunLimits | 请求中的限制参数 |

### 命名理由

**AgentRequest**：所有人一看就懂。"我发了一个 agent request，adapter 去执行它。" 和 response（事件流 + completion）天然配对。不需要解释什么是 "spec" 或 "harness"。

**AgentRuntime**：比 "Runtime" 更准确。Zora 里有各种 runtime（Node runtime、V8 runtime），加 Agent 前缀明确指向 agent 执行引擎。

---

## 三、架构分层

```
┌─────────────────────────────────────────────────────────────┐
│  Product Layer (runtime-agnostic)                            │
│                                                              │
│  AgentExecutionService    McpManager       MemoryAgent       │
│  AgentProfiles            HitlManager      AttachmentHandler │
│  SessionStore             SessionFork                        │
│                                                              │
│  产出: AgentRequest + AgentRuntimeTarget + forwardEvent      │
│  finally: memoryAgent.onConversationEnd()                    │
├──────────────────────────────────────────────────────────────┤
│  AgentRuntime Adapter Layer (translation)                    │
│                                                              │
│  ClaudeAdapter                  PiAdapter                    │
│  ├── MCP -> mcpServers          ├── AgentSession (核心)       │
│  ├── Skills -> plugins          ├── MCP -> customTools       │
│  ├── Attachments -> multimodal  ├── Skills -> prompt inject  │
│  ├── Fork -> SDK fork           ├── Attachments -> Image     │
│  └── Usage -> SDK result        ├── Fork -> 数据层复制        │
│                                 ├── Todo -> customTool       │
│                                 ├── AskUser -> customTool    │
│                                 └── Usage -> msg.usage       │
├──────────────────────────────────────────────────────────────┤
│  AgentRuntime Layer (execution)                              │
│                                                              │
│  Claude Agent SDK              Pi Agent Core / Coding Agent  │
│  query()                       AgentSession                  │
│  session / compaction          Agent / SessionManager        │
│  built-in tools                createCodingTools()           │
│  mcpServers / plugins          ModelRuntime / Settings       │
└──────────────────────────────────────────────────────────────┘
```

### 核心原则

1. Product Layer 决定"做什么"：MCP 配置、skills 路径、权限规则、记忆触发，全部 runtime 无关。
2. Adapter Layer 决定"怎么喂"：同一个 AgentRequest，Claude 和 Pi 各自翻译成自己 runtime 能消费的格式。
3. 切换 AgentRuntime 不影响前端：AgentStreamEvent 格式统一。
4. 开闭原则：新增 AgentRuntime 写新 Adapter，不修改 Product Layer 和已有 Adapter。

---

## 四、AgentRequest 定义

```typescript
// 替代 AgentHarnessSpec，纯重命名 + 字段不变
interface AgentRequest {
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
  limits: RunLimits;
  output: { incremental: boolean; visible: boolean };
}

interface RunLimits {
  maxTurns: number;
  maxOutputTokens: number;
  reasoningLevel: ReasoningLevel;
}
```

---

## 五、Pi AgentSession 集成方案

### 为什么选 AgentSession 而不是 AgentHarness

| 维度 | AgentHarness | AgentSession |
| --- | --- | --- |
| Session 管理 | 需自建 MemorySessionStorage | SessionManager.inMemory()，零配置 |
| Provider 管理 | 需手动构建 Models | ModelRuntime.create() + registerProvider() |
| Skills | loadSkills() + 手动 formatSkills | ResourceLoader 自动加载 |
| Compaction | 需手动配 hooks | auto-compaction 内置 |
| Auto-retry | 无 | 内置（可配置） |
| Tools | 需从 pi-coding-agent 导入 | createCodingTools() + customTools 参数 |
| 依赖 | pi-agent-core | pi-coding-agent（已安装） |
| 代码量 | 多（需手写 session/compaction/skills 集成） | 少（构造即用） |

红队辩论结论：之前选 AgentHarness 的理由（"session 管理会冲突"）是伪命题。Zora 的 SessionStore 是产品层消息持久化，AgentSession 的 SessionManager 是 runtime 内部状态管理，二者职责不同，互补而非冲突。

### 升级后的 Pi Adapter 架构

```
PiAgentRuntimeAdapter
  └── PiSessionBridge
        └── AgentSession (pi-coding-agent)
              ├── Agent (pi-agent-core)
              │     └── streamFn: ModelRuntime.streamSimple
              ├── SessionManager.inMemory()  -- Zora 自管持久化
              ├── SettingsManager.inMemory()
              ├── ModelRuntime + registerProvider()
              ├── ResourceLoader (systemPrompt + skills)
              ├── Tools: createCodingTools(cwd) + customTools[]
              │     ├── MCP bridge tools
              │     ├── Todo tool
              │     └── AskUser tool
              └── Auto-compaction (内置)
```

### PiSessionBridge 升级

PiSessionBridge 从手写 `PiAgentSession` (使用 `runAgentLoop`) 升级为使用 `AgentSession`：

```typescript
// 升级后的 PiSessionBridge
class PiSessionBridge {
  private readonly agents = new Map<string, AgentSessionEntry>();

  async getOrCreateAgent(
    sessionId: string,
    providerConfig: PiProviderConfig,
    workingDirectory: string,
    limits: RunLimits
  ): Promise<PiSessionHandle> {
    // 1. 创建 ModelRuntime
    const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
    modelRuntime.registerProvider(providerConfig.providerId, {
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
      api: providerConfig.api,
      models: [buildModelDefinition(providerConfig, limits)],
    });

    // 2. 创建 Agent
    const model = modelRuntime.getModel(providerConfig.providerId, providerConfig.model)!;
    const tools = createCodingTools(workingDirectory);
    const agent = new Agent({
      streamFn: (m, ctx, opts) => modelRuntime.streamSimple(m, ctx, opts),
      initialState: { model, systemPrompt: "", tools, thinkingLevel: "medium" },
    });

    // 3. 创建 AgentSession
    const sessionManager = SessionManager.inMemory(workingDirectory);
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      cwd: workingDirectory,
      agentDir: getZoraPluginPath(),
      settingsManager,
      systemPrompt: "", // 由 adapter 动态设置
    });

    const session = new AgentSession({
      agent,
      sessionManager,
      settingsManager,
      cwd: workingDirectory,
      modelRuntime,
      resourceLoader,
      customTools: [], // MCP/Todo/AskUser 由 adapter 注入
    });

    return new PiAgentSessionHandle(session, providerConfig);
  }
}
```

---

## 六、缺失能力清单

### P0：用户直接碰到报错或功能完全断裂

| # | 能力 | 根因 | 方案 | 层 |
| - | --- | --- | --- | --- |
| 1 | Fork 路径分流 | session-fork.ts 绑死 Claude SDK forkSdkSession() | 按 runtimeType 分流，Pi 走数据层复制 | Product |
| 2 | MCP 工具注入 | Pi 只有 6 个硬编码 coding tools | McpManager 产出配置，Pi adapter 包装成 ToolDefinition[] | Product + Adapter |
| 3 | Memory 触发 | onConversationEnd 只在 agent.ts | 移到 AgentExecutionService.execute() finally 块 | Product |

### P1：核心功能缺失但不报错

| # | 能力 | 根因 | 方案 | 层 |
| - | --- | --- | --- | --- |
| 4 | Skills | Pi 无加载机制 | ResourceLoader 自动加载，systemPrompt 注入 | Adapter |
| 5 | Attachments | Pi adapter 忽略字段 | 图片转 ImageContent，文本拼入 user message | Adapter |
| 6 | Todo | Pi 无 todo 工具 | 自定义 ToolDefinition，对齐 Claude 数据格式 | Adapter |
| 7 | Compaction | Pi 无上下文压缩 | AgentSession 内置 auto-compaction | Runtime (内置) |
| 8 | System Prompt | Pi 直接透传 | ResourceLoader systemPrompt + skills + 工具声明 | Adapter |

### P2：进阶能力

| # | 能力 | 根因 | 方案 | 层 |
| - | --- | --- | --- | --- |
| 9 | AskUser | Pi 无此工具 | 自定义 ToolDefinition，通过 forwardEvent 发事件 | Adapter |
| 10 | Usage | Pi event mapper 没映射 | message_end 时提取 usage（验证已确认数据存在） | Adapter |
| 11 | Session 持久化 | Pi session 全在内存 | SessionManager.inMemory() 够用，JSONL 可选增强 | Runtime |
| 12 | Subtask | Pi 无子任务 | 暂不做 | - |

---

## 七、实施切片

### 切片 0：命名修正 + Memory Hook + Fork 分流（前置）

**目标**：命名对齐，修复 P0 中不需要 AgentSession 的两个问题。

**改动**：

1. 全局重命名：
   - `AgentHarnessSpec` -> `AgentRequest`
   - `HarnessLimits` -> `RunLimits`
   - `RuntimeType` -> `AgentRuntimeType`
   - `RuntimeAdapter` -> `AgentRuntimeAdapter`
   - `RuntimeStartInput` -> `AgentRuntimeInput`
   - `RuntimeRunHandle` -> `AgentRuntimeHandle`
   - `RuntimeExecutionTarget` -> `AgentRuntimeTarget`
   - `RuntimeNotAvailableError` -> `AgentRuntimeNotAvailableError`

2. Memory Hook 移位：
   - `agent.ts` 移除 `memoryAgent.onConversationEnd()` 调用
   - `AgentExecutionService.execute()` finally 块添加 `memoryAgent.onConversationEnd()`

3. Fork 分流：
   - `session-fork.ts` 新增 `forkPiSession()` 函数
   - 按 `runtimeType` 分流：Claude 走 SDK fork，Pi 走数据层复制

**验证**：
- TypeScript 编译通过
- Pi 会话 fork 不报错，新会话消息历史完整
- Pi 会话结束后记忆日志触发

---

### 切片 1：PiSessionBridge 升级到 AgentSession（核心）

**目标**：把 PiSessionBridge 从 `runAgentLoop` 升级到 `AgentSession`，一次性获得 compaction + auto-retry + skills 基础。

**改动**：

1. `pi-session-bridge.ts`：
   - 移除 `PiAgentSession` 类（手写 messages 管理 + runAgentLoop 调用）
   - 新建 `PiAgentSessionHandle` 包装 `AgentSession`
   - `createPiSession()` 改为构造 `ModelRuntime` + `Agent` + `AgentSession`
   - `run()` 方法改为调用 `session.prompt()` + `session.waitForIdle()`
   - `replaceHistory()` 改为通过 `sessionManager` 重建上下文
   - `abort()` 改为 `session.abort()`
   - `dispose()` 改为 `session.dispose()`

2. `pi-provider-registry.ts`：
   - 新增 `buildModelDefinition()` 返回 pi-coding-agent 的 Model 格式
   - 新增 `buildProviderConfigInput()` 返回 `ProviderConfigInput`

3. `pi-event-mapper.ts`：
   - 适配 `AgentSessionEvent`（比 `AgentEvent` 多了 session 特定事件）
   - 新增 `compaction_start` / `compaction_end` 事件映射
   - 新增 `agent_settled` 事件映射（替代 `agent_end` 作为最终完成信号）

4. `pi-adapter.ts`：
   - 适配新 handle 接口
   - streamingBehavior 配置（"steer" 模式）

**验证**：
- Pi 会话正常对话
- 长对话触发 auto-compaction，不撞 context window
- Skills 能通过 ResourceLoader 加载
- Coding tools 正常工作
- 事件流正确映射到前端

---

### 切片 2：MCP 工具桥接

**目标**：Pi 会话能使用所有 MCP 工具。

**改动**：

1. `mcp-manager.ts`：
   - 新增 `getMcpToolDefinitions()` 方法，返回标准化 tool 定义列表

2. 新增 `pi-mcp-bridge.ts`：
   - 把 MCP tool 定义包装成 `ToolDefinition`（pi-coding-agent 的 customTools 格式）
   - execute 时通过 MCP 协议调用对应 server

3. `pi-adapter.ts`：
   - 在构造 AgentSession 时，把 MCP tools 作为 `customTools` 传入
   - 或通过 AgentSession 的 extension 机制注入

**验证**：
- Pi 会话能调用 web_search、web_fetch、schedule
- 用户自定义 MCP server 也能在 Pi 会话中使用
- HITL 权限检查正常工作

---

### 切片 3：Attachments + Todo + System Prompt

**目标**：补齐体验层能力。

**改动**：

1. Attachments：
   - `pi-adapter.ts`：处理 attachments 字段
   - 图片转 `ImageContent[]`，传入 `session.prompt(text, { images })`
   - 文本文件读取后拼入 user message

2. Todo：
   - 新增 `pi-todo-tool.ts`：实现 TodoWrite/TodoRead 作为 `ToolDefinition`
   - 数据格式与 Claude SDK 对齐（JSON 数组）
   - 通过 `customTools` 注入 AgentSession
   - `pi-event-mapper.ts`：映射 todo 事件到前端格式

3. System Prompt：
   - `pi-adapter.ts`：构建完整 system prompt
   - 基础 prompt（from AgentRequest）+ skills 内容（from ResourceLoader）+ 工具能力声明
   - 通过 `DefaultResourceLoader` 的 `systemPrompt` 参数注入

4. Usage 映射：
   - `pi-event-mapper.ts`：在 `message_end` 处理中提取 `message.usage`
   - 映射到 `AgentStreamEvent` 的 result event

**验证**：
- Pi 会话图片附件可用
- Todo 创建后前端展示
- System prompt 包含 skills 内容
- Usage 展示正确

---

### 切片 4：AskUser + 清理

**目标**：补齐最后一个交互工具，清理冗余代码。

**改动**：

1. AskUser：
   - 自定义 `ToolDefinition`，execute 时通过 `forwardEvent` 发送 `ask_user_request` 事件
   - 等待前端响应后返回

2. 清理：
   - 删除 `pi-conversation.ts`（AgentSession 自管 session 上下文）
   - 删除 `pi-runtime-guard.ts`（AgentSession 自管 turn 限制，或通过配置）
   - 审视所有代码，删除冗余兜底
   - 确保两个 adapter 的行为一致性

**验证**：
- Pi 会话能向用户提问
- 两个 runtime 的功能对齐
- 无冗余代码

---

## 八、依赖关系

```
切片0 (命名+Memory+Fork) ─── 前置，必须先做
    │
    └──> 切片1 (AgentSession升级) ─── 后续切片的基础
              │
              ├──> 切片2 (MCP桥接)
              │
              └──> 切片3 (Attach+Todo+SysPrompt+Usage)
                       │
                       └──> 切片4 (AskUser+清理)
```

切片 0 是前置（命名对齐 + 基础修复）。切片 1 是核心（升级到 AgentSession）。切片 2 和 3 可以在 1 之后并行。切片 4 收尾。

---

## 九、不做的事

1. **Subtask**：优先级 P3，工作量大，当前不做
2. **通用 Agent Platform**：不为未来可能的 runtime 预先抽象
3. **Pi JSONL 持久化**：SessionManager.inMemory() 够用，Zora 的 SessionStore 是唯一真相源
4. **Streaming partial messages**：当前事件映射够用，不做流式优化
5. **ToolRegistry 抽象**：过度设计，每个 adapter 自己管理工具即可
6. **ProductivityProfile 重构**：过早抽象，当前够用

---

## 十、文件影响范围

### 切片 0

| 文件 | 改动类型 |
| --- | --- |
| `src/main/agent-profiles/types.ts` | 重命名 AgentHarnessSpec -> AgentRequest, HarnessLimits -> RunLimits |
| `src/main/runtime/types.ts` | 重命名 Runtime* -> AgentRuntime* |
| `src/main/runtime/*.ts` | 所有文件适配新命名 |
| `src/main/agent-execution-service.ts` | 添加 memory hook 到 finally 块 |
| `src/main/agent.ts` | 移除 memory hook 调用 |
| `src/main/session-fork.ts` | 新增 forkPiSession()，按 runtimeType 分流 |

### 切片 1

| 文件 | 改动类型 |
| --- | --- |
| `src/main/runtime/pi-session-bridge.ts` | 重写：runAgentLoop -> AgentSession |
| `src/main/runtime/pi-provider-registry.ts` | 新增 buildModelDefinition() |
| `src/main/runtime/pi-event-mapper.ts` | 适配 AgentSessionEvent |
| `src/main/runtime/pi-adapter.ts` | 适配新 handle 接口 |

### 切片 2

| 文件 | 改动类型 |
| --- | --- |
| `src/main/mcp-manager.ts` | 新增 getMcpToolDefinitions() |
| `src/main/runtime/pi-mcp-bridge.ts` | 新增文件 |
| `src/main/runtime/pi-adapter.ts` | 注入 MCP tools |

### 切片 3

| 文件 | 改动类型 |
| --- | --- |
| `src/main/runtime/pi-adapter.ts` | 处理 attachments，构建 system prompt |
| `src/main/runtime/pi-todo-tool.ts` | 新增文件 |
| `src/main/runtime/pi-event-mapper.ts` | 映射 todo + usage |

### 切片 4

| 文件 | 改动类型 |
| --- | --- |
| `src/main/runtime/pi-ask-user-tool.ts` | 新增文件 |
| `src/main/runtime/pi-conversation.ts` | 删除 |
| `src/main/runtime/pi-runtime-guard.ts` | 删除（如果 AgentSession 自管 turn 限制）|
