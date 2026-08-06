# Pi Harness 能力补齐与架构分层方案

## 一、问题全貌

当前 Pi 路径使用 `pi-agent-core` 的低层 `runAgentLoop` API，绕过了 `pi-coding-agent` 已经实现的高层能力（Session/Skills/Compaction/Extension）。同时，Claude 路径在 `productivity-runner.ts` 和 `agent.ts` 里硬编码了大量产品层逻辑（MCP 注入、Skills 加载、附件处理、Memory 触发），这些逻辑没有抽象到 runtime-agnostic 的位置。

结果是：Pi 路径只有 6 个 coding tools + 基础 agent loop，缺失 12 项产品能力。

## 二、缺失能力清单（按产品功能维度，含根因和方案）

### P0：用户直接碰到报错或功能完全断裂

#### 1. Fork 路径分流
- **根因**：`session-fork.ts` 的 `forkSessionFromSource()` 直接调 `forkSdkSession()` from Claude SDK，需要 `source.sdkSessionId`。Pi session 没有这个字段，fork 直接报错。
- **方案**：在 `forkSessionFromSource` 入口按 `runtimeType` 分流。Pi 走数据层 fork：复制 Zora session 消息历史到新 session，不调 SDK fork。下次 run 时 `buildPiConversationHistory` 自然重建。
- **分层**：Fork 是产品层操作（复制 session 数据），Claude 额外做 SDK fork，Pi 不需要。

#### 2. MCP 工具注入
- **根因**：Claude 路径通过 `McpManager.buildSdkMcpServers()` 把用户配置的所有 MCP server 注入 SDK options。Pi 的 `createPiTools()` 只返回硬编码 6 个 coding tools，无 MCP 注入机制。
- **方案**：产品层统一产生 MCP server 配置，Claude adapter 转成 `SdkMcpServers` 注入 SDK，Pi adapter 把 MCP server 的 tools 包装成 `AgentTool` 注入 Pi agent。
- **分层**：MCP 配置由产品层 `McpManager` 统一管理，Adapter 负责格式转换。

#### 3. Memory Agent 触发
- **根因**：`agent.ts` 的 `runAgentWithProfile` 在 Claude 会话结束后调 `memoryAgent.onConversationEnd()`。Pi 路径没有这个调用。
- **方案**：已在不稳定改动中：把 `onConversationEnd` 调用从 `agent.ts` 移到 `AgentExecutionService.execute()` 的 finally 块。两个 adapter 完成后都会触发。
- **分层**：Memory 是产品层 Hook，在 ExecutionService 层统一触发。

### P1：核心功能缺失但不报错

#### 4. Skills 系统
- **根因**：Claude 路径通过 `plugins: [{ type: "local", path: getZoraPluginPath() }]` 把 `~/.zora/skills/` 下的 SKILL.md 注入 SDK。Pi 无 skill 加载机制。
- **方案**：pi-coding-agent 已导出 `loadSkills()` 和 `formatSkillsForPrompt()`。Pi adapter 在 `start()` 时调用 `loadSkills()` 加载 skills，用 `formatSkillsForPrompt()` 格式化后拼入 system prompt。Claude 路径保持 SDK plugin 注入不变。
- **分层**：Skills 目录路径由产品层决定（`getZoraPluginPath()`），Adapter 负责加载和格式转换。

#### 5. Attachments（文件附件）
- **根因**：`RuntimeStartInput` 定义了 `attachments?: FileAttachment[]`，但 `PiRuntimeAdapter` 忽略该字段。Claude 路径通过 `buildMultimodalPrompt()` 处理图片（base64）、文档（PDF fallback）、文本文件。
- **方案**：Pi adapter 在 `start()` 时处理 attachments：图片转成 Pi 的 `ImageContent`（pi-ai 支持），文本文件读取后拼入 user message。复用 `attachment-handler.ts` 的文件读取逻辑，只做 Pi 格式转换。
- **分层**：附件解析（读文件、判断类型）由产品层统一处理，Adapter 负责目标格式转换。

#### 6. TodoWrite/TodoRead
- **根因**：Claude SDK 内置 TodoWrite/TodoRead 工具。Pi 的 `createPiTools()` 没有提供 todo 工具。
- **方案**：pi-coding-agent 的 examples 里有 todo extension 参考实现。把 todo 工具作为自定义 `AgentTool` 实现，加入 Pi 的工具集。todo 数据格式与 Claude SDK 对齐（JSON 数组），通过 event mapper 映射到前端的 todo 展示。
- **分层**：Todo 是产品层工具（数据格式统一），Adapter 负责注册到对应 runtime。

#### 7. Context Compaction
- **根因**：Claude SDK 有自动上下文压缩（`compact_boundary` system message）。Pi 无等价机制，会撞 context window 上限。
- **方案**：pi-coding-agent 和 pi-agent-core 都有完整的 compaction 子系统（`compact()`, `shouldCompact()`, `prepareCompaction()`, `generateSummary()`）。升级 Pi adapter 使用 `AgentHarness` 或 `AgentSession` 替代裸 `runAgentLoop`，启用 auto-compaction。
- **分层**：Compaction 是 runtime 内部能力，Adapter 负责配置和触发。产品层只需处理 compaction 事件（如果有 UI 展示需求）。

#### 8. System Prompt 定制
- **根因**：Pi 直接用 `harness.prompt.system` 透传，没有针对 Pi runtime 做定制（工具描述格式差异、能力声明差异、skill 注入到 system prompt 等）。
- **方案**：构建 Pi 专属的 system prompt builder，在 harness prompt 基础上追加 skills 内容（通过 `formatSkillsForPrompt()`）和 Pi 工具能力声明。
- **分层**：基础 system prompt 由产品层提供（harness.prompt.system），Adapter 负责追加 runtime 特定内容。

### P2：进阶能力缺失

#### 9. AskUserQuestion
- **根因**：Claude SDK 有 AskUserQuestion 工具，hitl.ts 完整实现了 `pendingAskUsers` 机制。Pi 没有这个工具。
- **方案**：把 AskUserQuestion 作为自定义 `AgentTool` 实现注入 Pi。工具 execute 时通过 `forwardEvent` 发送 `ask_user_request` 事件，等待前端响应后返回。
- **分层**：AskUser 是产品层工具（事件格式统一），Adapter 负责注册。

#### 10. Usage/Cost 追踪
- **根因**：Claude SDK result message 自带 `usage`（input/output/cache tokens）和 `total_cost_usd`。Pi 的 event mapper 没有映射 usage 信息。
- **方案**：Pi 的 `AssistantMessage` 类型已包含 `usage` 字段。在 `PiEventMapper` 的 `message_end` 处理中提取 usage 信息，映射到 `AgentStreamEvent` 的 result event。
- **分层**：Usage 是 runtime 层数据，Adapter 负责提取和上报。产品层统一展示。

#### 11. Session 持久化/重启恢复
- **根因**：Pi session 全在内存（`PiSessionBridge.agents Map`），重启后丢失。Claude 通过 `sdkSessionId` 持久化 SDK session。
- **方案**：升级到 `AgentSession` 后，Pi session 可通过 `SessionManager`（JSONL 文件存储）持久化。重启后从 JSONL 恢复 session 上下文。当前 `buildPiConversationHistory` 从 Zora 持久化消息重建历史的方式可作为 fallback。
- **分层**：Session 持久化是 runtime 内部能力，Adapter 负责管理生命周期。产品层只关心 Zora session 数据（消息历史）。

#### 12. Subtask（子任务）
- **根因**：Claude SDK 内置 Task/Agent 工具可 spawn 子任务。Pi 没有等价物。
- **方案**：暂不做。Pi agent core 的 `Agent` 类支持 `prompt()` 和 `followUp()`，理论上可以实现子 agent，但工作量较大且优先级低。
- **分层**：Subtask 是 runtime 层能力，需要 Adapter 深度集成。

## 三、架构分层设计

### 分层模型

```
┌─────────────────────────────────────────────────────────┐
│  Product Layer (runtime-agnostic)                        │
│                                                          │
│  McpManager          SkillProvider       AttachmentHandler│
│  (MCP server 配置)   (skills 目录路径)    (文件读取解析)  │
│  HitlManager         MemoryAgent         ForkStrategy    │
│  (权限规则)           (记忆触发)          (数据层复制)    │
│                                                          │
│  AgentExecutionService                                   │
│  ┌─ resolve target ──→ build harness ──→ router.start ─┐│
│  └─ finally: memoryAgent.onConversationEnd() ◄─────────┘│
├──────────────────────────────────────────────────────────┤
│  Harness Layer (data contract)                           │
│  AgentHarnessSpec:                                       │
│    prompt { system, user, dynamicContext }               │
│    conversation { messages, persistence }                │
│    workspace { cwd }                                     │
│    permissions { mode }                                  │
│    limits { maxTurns, maxOutputTokens, reasoningLevel }  │
│    target { runtimeType, provider, protocol, modelId }   │
├──────────────────────────────────────────────────────────┤
│  Adapter Layer (runtime-specific translation)             │
│                                                          │
│  ClaudeRuntimeAdapter          PiRuntimeAdapter           │
│  ┌─────────────────────┐      ┌──────────────────────┐   │
│  │ MCP → mcpServers    │      │ MCP → AgentTool[]    │   │
│  │ Skills → plugins    │      │ Skills → prompt inj  │   │
│  │ Attachments → multi │      │ Attachments → image  │   │
│  │ Memory → (已移出)   │      │ Memory → (已移出)    │   │
│  │ Fork → SDK fork     │      │ Fork → 数据层复制    │   │
│  │ Compaction → SDK    │      │ Compaction → harness │   │
│  │ Usage → SDK result  │      │ Usage → msg.usage    │   │
│  └─────────────────────┘      └──────────────────────┘   │
├──────────────────────────────────────────────────────────┤
│  Runtime Layer                                            │
│  Claude Agent SDK              Pi Agent Core / Coding    │
│  (query, session, tools)       (AgentHarness, Session)   │
└──────────────────────────────────────────────────────────┘
```

### 核心原则

1. **产品层决定"有哪些能力"**：MCP server 配置、skills 目录、附件文件、权限规则、memory 触发时机，都由产品层统一管理。
2. **Adapter 层决定"怎么喂给 runtime"**：Claude 用 SDK plugin/mcpServers/multimodal，Pi 用 prompt injection/AgentTool[]/ImageContent。
3. **Runtime 切换不影响前端**：前端看到的 AgentStreamEvent 格式统一，todo/usage/compaction 事件格式与 runtime 无关。
4. **开闭原则**：新增 Runtime 写新 Adapter，不修改产品层和已有 Adapter。

### 关键架构决策

#### 决策 1：Pi adapter 升级到 AgentHarness/AgentSession

当前 Pi adapter 直接用 `runAgentLoop`（低层 API），手动管理 messages 数组和 turn guard。升级到 `AgentHarness` 或 `AgentSession` 可以直接获得：
- Session 管理（JSONL 持久化、tree 结构、branching）
- Skills 加载（`loadSkills()` + `formatSkillsForSystemPrompt()`）
- Context compaction（auto-compaction + 手动 compact）
- 事件系统（`on()` hooks，支持 `before_agent_start` / `session_before_compact` 等）

升级路径：`PiSessionBridge` 内部从 `runAgentLoop` 切换到 `AgentHarness`，保持对外接口不变。

#### 决策 2：MCP 工具桥接

Pi 没有 MCP 原生支持。方案是：
1. 产品层 `McpManager` 已有 `buildSdkMcpServers()` 供 Claude 使用
2. 新增 `McpManager.getToolDefinitions()` 返回标准化的 tool 定义列表（name/description/inputSchema）
3. Pi adapter 把每个 MCP tool 包装成 `AgentTool`，execute 时通过 MCP 协议调用对应 server
4. 内置 MCP server（web_search/web_fetch/schedule）也走同一通路

这个方案的好处是：MCP server 管理逻辑不变，只是多了一个消费端。

#### 决策 3：Fork 双路径

```typescript
// session-fork.ts
async function forkSessionFromSource(input: ForkSessionFromSourceInput): Promise<SessionForkResult> {
  const source = await getSessionMeta(input.sourceSessionId, input.workspaceId);

  // 按 runtimeType 分流
  if (source.runtimeType === "pi") {
    return forkPiSession(input, source);
  }
  return forkClaudeSession(input, source);  // 原有逻辑
}

async function forkPiSession(input, source): Promise<SessionForkResult> {
  // 纯数据层操作：复制 Zora session 消息到新 session
  // 不需要 SDK fork，不需要 transcript 复制
  // 下次 run 时 buildPiConversationHistory 自然重建
}
```

#### 决策 4：产品工具注册中心

当前 Pi 硬编码 6 个 coding tools。应改为：

```typescript
// 产品层统一注册
interface ToolRegistry {
  getBuiltinTools(cwd: string): Promise<AgentTool[]>;      // coding tools (Pi native)
  getMcpTools(): Promise<AgentTool[]>;                      // MCP tools (bridged)
  getTodoTool(): AgentTool;                                  // Todo tool
  getAskUserTool(forwardEvent): AgentTool;                  // AskUser tool
}

// Pi adapter 消费
const tools = [
  ...toolRegistry.getBuiltinTools(cwd),
  ...toolRegistry.getMcpTools(),
  toolRegistry.getTodoTool(),
  toolRegistry.getAskUserTool(forwardEvent),
];
```

Claude adapter 不需要 ToolRegistry，因为 SDK 自己处理 tool 注册。ToolRegistry 只服务 Pi。

## 四、实施切片

按垂直切片方法论，每个切片定义真实用户流程 + 验证标准。

### 切片 1：Fork 分流 + Memory Hook（P0 x2）

**用户流程**：
1. 创建一个 Pi runtime 会话，发几条消息
2. 点击会话菜单的 "Fork" 按钮
3. 验证 fork 成功，新会话有完整的消息历史
4. 在新会话里继续对话，验证上下文连续
5. 结束会话后，检查记忆日志是否触发

**代码改动**：
- `session-fork.ts`：新增 `forkPiSession()` 函数，按 `runtimeType` 分流
- `agent-execution-service.ts`：在 finally 块加 `memoryAgent.onConversationEnd()` 调用（已有不稳定改动）
- `agent.ts`：移除 `memoryAgent.onConversationEnd()` 调用（已有不稳定改动）

**验证标准**：
- Pi 会话 fork 不报错
- Fork 后新会话消息历史完整
- Pi 会话结束后记忆日志正常触发

### 切片 2：MCP 工具注入 Pi（P0 x1）

**用户流程**：
1. 创建一个 Pi runtime 会话
2. 发送消息让 agent 调用 web_search（内置 MCP）
3. 验证 agent 能调用 web_search 并返回结果
4. 发送消息让 agent 调用 zora_schedule_manage（内置 MCP）
5. 验证定时任务功能正常

**代码改动**：
- `mcp-manager.ts`：新增 `getMcpToolDefinitions()` 方法
- 新增 `pi-mcp-bridge.ts`：把 MCP tool 定义包装成 `AgentTool`
- `pi-tools.ts`：`createPiTools()` 合并 coding tools + MCP tools
- `pi-adapter.ts`：传递 MCP 配置

**验证标准**：
- Pi 会话能调用 web_search、web_fetch、schedule
- 用户自定义 MCP server 也能在 Pi 会话中使用
- HITL 权限检查正常工作（MCP tool 需要授权时弹出确认）

### 切片 3：Skills + Attachments + Todo（P1 x3）

**用户流程**：
1. Pi 会话中使用 `/lark-doc` skill，验证 skill 能加载和执行
2. Pi 会话中拖入一张图片，验证 agent 能看到图片内容
3. Pi 会话中 agent 使用 TodoWrite 创建 todo，验证前端展示

**代码改动**：
- `pi-adapter.ts`：在 `start()` 时调用 `loadSkills()` 加载 skills，`formatSkillsForPrompt()` 拼入 system prompt
- `pi-adapter.ts`：处理 attachments，图片转 `ImageContent`，文本拼入 user message
- 新增 `pi-todo-tool.ts`：实现 TodoWrite/TodoRead 作为 `AgentTool`
- `pi-event-mapper.ts`：映射 todo 事件到前端格式

**验证标准**：
- Pi 会话中 skill 列表与 Claude 会话一致
- Pi 会话中图片附件能被 agent 识别
- Pi 会话中 todo 创建后前端正确展示

### 切片 4：AgentHarness 升级 + Compaction + System Prompt + Usage（P1-P2 合并）

**用户流程**：
1. Pi 会话中持续对话直到接近 context window 上限
2. 验证 auto-compaction 自动触发，对话继续正常
3. 验证 system prompt 包含 skills 和工具能力声明
4. 验证会话结束后的 usage/cost 展示正确

**代码改动**：
- `pi-session-bridge.ts`：从 `runAgentLoop` 升级到 `AgentHarness`
- 启用 auto-compaction
- 构建 Pi system prompt builder
- `pi-event-mapper.ts`：映射 usage 信息

**验证标准**：
- Pi 会话长对话不撞 context window
- System prompt 包含 skills 内容
- Usage 展示正确

## 五、不做的事

1. **Subtask**：优先级 P3，工作量大，当前不做
2. **通用 Agent Platform**：不为未来可能的 runtime 预先抽象，只保证 Claude 和 Pi 两条路径共享产品组装逻辑
3. **Pi SDK session 持久化到磁盘**：当前 `buildPiConversationHistory` 从 Zora 持久化消息重建的方式够用，AgentHarness 的 JSONL 持久化是可选增强，不是必须
4. **Streaming partial messages**：Pi 的 event 是 post-hoc 映射，当前够用，不做流式优化

## 六、依赖关系

```
切片1 (Fork+Memory) ─── 独立，可立即开始
切片2 (MCP)       ─── 独立，可并行
切片3 (Skills+Attach+Todo) ─── 依赖切片2的MCP bridge模式
切片4 (Harness升级)   ─── 依赖切片3的Skills加载（system prompt构建）
```

切片 1 和 2 可以并行。切片 3 依赖 2 的 MCP bridge 模式（AgentTool 包装方式）。切片 4 依赖 3 的 skills 加载（system prompt 构建需要 skills 内容）。
