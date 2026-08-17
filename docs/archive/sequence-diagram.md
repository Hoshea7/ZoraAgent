# Zora 时序图（历史存档）

> 状态：本文记录 Claude Runtime 单引擎时期的时序，当前不作为现役架构依据。现役 Runtime 路由、Pi checkpoint、跨 Runtime 历史和引导事件以 `README.md`、`src/main/runtime/` 和 `tests/e2e/` 为准。
>
> 本文保留飞书、定时任务和记忆处理的历史入口说明。桌面端当前通过 `AgentExecutionService → AgentRuntimeRouter → ClaudeAgentRuntimeAdapter / PiAgentRuntimeAdapter` 执行，产品历史由 Zora JSONL 持有。

---

## 1. 桌面端对话主链路

用户在 Electron 渲染进程输入消息，经 IPC 到达主进程，最终通过 Claude Agent SDK 执行并流式回传结果。

```mermaid
sequenceDiagram
    actor U as 用户
    participant R as Renderer (React UI)
    participant P as Preload (IPC Bridge)
    participant M as Main Process (index.ts)
    participant SR as SessionRunner
    participant PR as ProductivityRunner
    participant PB as PromptBuilder / DynamicContext
    participant QP as QueryProfiles (productivity)
    participant HITL as HITL 权限模块
    participant MCP as MCP Manager
    participant A as Agent (agent.ts)
    participant SDK as Claude Agent SDK
    participant SS as SessionStore
    participant MA as MemoryAgent

    U->>R: 输入消息 + 选择权限模式/模型
    R->>P: window.zora.sendPrompt()
    P->>M: ipcMain.handle("agent:chat")
    M->>SR: runPromptInSession({sessionId, text, ...})
    SR->>SS: getSessionMeta(sessionId)
    SR->>SS: resolveDefaultModelTarget()（若未锁定）
    SR->>SS: updateSessionMeta()（锁定 Provider/Model）
    SR->>SS: saveAttachments()（若有附件）
    SR->>SS: appendMessageRecord({kind:"user"})
    SR->>MA: scheduleProcessing(sessionId)
    SR->>PR: runProductivitySession({sessionId, text, ...})

    Note over PR: —— 构建运行 Profile ——
    PR->>SS: getSdkSessionId()（检查是否已有 SDK 会话）
    PR->>SS: loadMessages()（若无 SDK 会话，加载本地历史用于恢复）
    PR->>PB: buildZoraPrompt(prompt, workspace, cwd)
    PB-->>PR: 注入动态上下文的完整 prompt
    PR->>QP: buildProductivityProfile({userPrompt, cwd, ...})
    QP->>PB: buildZoraSystemPrompt()
    QP->>HITL: createCanUseTool(onEvent, sessionId)
    QP->>MCP: getSharedMcpManager().buildSdkMcpServers()
    QP-->>PR: QueryProfile（含 options: env, mcpServers, canUseTool, ...）

    Note over PR,A: —— 执行 Agent ——
    PR->>A: runAgentWithProfile(sessionId, profile, forwardEvent)
    A->>SDK: query({prompt: inputStream, options})
    A-->>M: emitAgentStatus("started")

    loop Agent Loop（流式事件）
        SDK-->>A: system:init（SDK 会话 ID）
        A->>SS: setSdkSessionId(sessionId, sdkSessionId)

        SDK-->>A: stream_event（thinking delta）
        A-->>R: forwardEvent → IPC "agent:stream"（思考过程）

        SDK-->>A: assistant（tool_use）
        A->>HITL: canUseTool(toolName, input)
        alt 自动放行（读操作 / Smart / YOLO / 白名单）
            HITL-->>SDK: {behavior: "allow"}
        else 需用户确认（Ask 模式 + 写操作）
            HITL-->>R: forwardEvent({type:"permission_request"})
            R-->>U: 展示权限确认 Banner
            U->>R: 允许 / 拒绝 / 本会话白名单
            R->>M: ipcMain.handle("agent:permission:respond")
            M->>HITL: respondToPermission(requestId, behavior, alwaysAllow)
            HITL-->>SDK: {behavior: "allow" | "deny"}
        end

        SDK-->>A: user（tool_result）
        A-->>R: forwardEvent（工具结果）
        A->>SS: persistToolResults()

        SDK-->>A: assistant（text 回复）
        A-->>R: forwardEvent → IPC "agent:stream"（回复内容）
        A->>SS: persistAssistantMessage()
    end

    SDK-->>A: result（结束）
    A-->>R: emitAgentStatus("finished")
    A->>MA: onConversationEnd(sessionId)（触发记忆检查）
    A->>HITL: clearAllPending()
    A->>SS: 清理活跃运行状态
```

---

## 2. 飞书远程触发链路

飞书机器人通过 WebSocket 长连接接收消息，绑定到本地 Session 后执行 Agent，并将结果回发飞书。

```mermaid
sequenceDiagram
    actor FU as 飞书用户
    participant FL as 飞书开放平台
    participant GW as FeishuGateway (WSClient)
    participant MH as FeishuMessageHandler
    participant FB as FeishuBridge
    participant SB as SessionBinder
    participant MS as FeishuMessageSender
    participant PR as ProductivityRunner
    participant A as Agent (agent.ts)
    participant SDK as Claude Agent SDK
    participant SS as SessionStore

    Note over GW: 飞书 Bridge 启动时已建立 WS 长连接

    FU->>FL: 发送私聊/群聊消息（群聊需 @机器人）
    FL->>GW: WS 推送 im.message.receive_v1 事件
    GW->>MH: onMessage(data)

    MH->>MH: 去重检查（eventId / messageId）
    MH->>MH: 过滤非 user 消息 + 群聊 @ 验证
    MH->>MH: cleanupTextContent()（移除 @mention 标记）

    alt 斜杠命令 (/help /new /stop /status)
        MH->>MH: handleCommand()
        MH->>MS: 发送命令回复
    else 普通对话
        MH->>FB: triggerAgent(chatId, senderId, chatType, text, messageId)
    end

    FB->>SB: resolveBinding(chatId, senderId, chatType)
    SB->>SS: 查找/创建飞书 Session 绑定
    SB-->>FB: FeishuChatBinding {sessionId, workspaceId}

    FB->>FB: 检查 busySessions / getAgentRunInfo()
    alt 会话忙碌
        FB->>MS: sendText("⏳ Zora 正在处理…")
    else 空闲
        FB->>MS: onAgentStart(chatId, messageId)
        MS->>FL: 发送"开始处理"卡片 + Typing 表情
        FB->>SS: persistIncomingMessage()
        FB->>PR: runProductivitySession({sessionId, text, permissionMode:"bypassPermissions", source:"feishu"})

        Note over PR,SDK: 同桌面端 Agent 执行流程
        PR->>A: runAgentWithProfile()
        A->>SDK: query()

        loop 流式事件回传
            SDK-->>A: thinking / tool_use / tool_result / assistant
            A->>FB: createFeishuForwarder()（转发事件）
            FB->>MS: handleAgentEvent()（更新飞书卡片）
            FB->>M: notifyAgentStreamEvent()（同步到桌面 UI）
        end

        SDK-->>A: result
        A->>FB: Agent 完成
        FB->>MS: onAgentEnd(sessionId, "success")
        MS->>FL: 更新卡片为最终结果 + 移除 Typing
    end

    FB->>FB: busySessions.delete(sessionId)
```

---

## 3. 定时任务链路

ScheduleRunner 定时轮询到期任务，创建新 Session 并执行 Agent。

```mermaid
sequenceDiagram
    participant SR as ScheduleRunner
    participant SST as ScheduleStore
    participant SS as SessionStore
    participant SRunner as SessionRunner
    participant PR as ProductivityRunner
    participant A as Agent (agent.ts)
    participant SDK as Claude Agent SDK
    participant R as Renderer (UI)

    Note over SR: 启动后 1s 首次检查，之后按 nextRunAt 定时

    loop 轮询循环
        SR->>SST: claimDueScheduledTask(now)
        alt 有到期任务
            SST-->>SR: task {workspaceId, prompt, title}
            SR->>SS: createSession(title, workspaceId)
            SR->>SS: appendMessageRecord({kind:"user", text:task.prompt})
            SR->>SRunner: runPromptInSession({sessionId, text, source:"schedule"})

            Note over SRunner,SDK: 同桌面端流程
            SRunner->>PR: runProductivitySession()
            PR->>A: runAgentWithProfile()
            A->>SDK: query()

            SDK-->>A: 流式事件
            A->>R: forwardEvent → IPC "agent:stream"

            SDK-->>A: result
            SR->>SST: recordScheduledTaskRun(task.id, status)
            SR->>SST: 更新 nextRunAt
        else 无到期任务
            SST-->>SR: null
            SR->>SR: 设置下一次定时器
        end
    end
```

---

## 4. 会话结束后的记忆处理流程

Agent 执行完成后，MemoryAgent 根据记忆模式（Immediate / Batch / Manual）决定何时整理长期记忆。

```mermaid
sequenceDiagram
    participant A as Agent (agent.ts)
    participant MA as MemoryAgent
    participant MS as MemorySettings
    participant MF as MemoryStore (.zora/)
    participant SS as SessionStore
    participant QP as QueryProfiles (memory)
    participant SDK as Claude Agent SDK

    A->>MA: onConversationEnd(sessionId, workspaceId)
    MA->>MS: loadMemorySettings()

    alt 记忆未启用
        MA-->>A: 跳过
    else Immediate 模式
        MA->>MA: trackPendingSession()
        MA->>MA: enqueueProcess(sessionId)
    else Batch 模式
        MA->>MA: trackPendingSession()
        alt 队列已满 (≥8)
            MA->>MA: processPendingBatch()
        else
            MA->>MA: resetBatchIdleTimer(idleMinutes)
        end
    else Manual 模式
        MA->>MA: trackPendingSession()（暂存，等待手动触发）
    end

    Note over MA: —— 执行记忆处理 ——
    MA->>SS: loadMessages(sessionId)
    alt 消息数 < 4
        MA-->>MA: 跳过（below_threshold）
    else 已处理过且无新消息
        MA-->>MA: 跳过（unchanged）
    else 需处理
        MA->>MF: loadFile("MEMORY.md")
        MA->>MF: loadFile("USER.md")
        MA->>MA: buildMemoryPrompt(messages, title, memory, user)

        alt Batch 多会话
            MA->>MA: buildBatchMemoryPrompt(entries)
        end

        MA->>QP: buildMemoryProfile({sdkRuntime, prompt})
        QP-->>MA: QueryProfile（memory，无 canUseTool）

        MA->>SDK: runAgentWithProfile(memorySessionId, profile)
        SDK-->>MA: Agent 读取/写入 MEMORY.md, USER.md, daily log
        SDK-->>MA: result

        MA->>MA: processedMessageCounts.set(sessionId, messages.length)
        MA->>MA: deletePendingContext(sessionId)
    end
```

---

## 5. 完整入口全景

三条入口链路汇聚到同一个 Agent 执行引擎。

```mermaid
flowchart LR
    subgraph 入口层
        A1[桌面端 IPC agent:chat]
        A2[飞书 WS 消息]
        A3[定时任务 ScheduleRunner]
    end

    subgraph Harness 层
        B1[SessionRunner]
        B2[FeishuBridge]
        B3[ProductivityRunner]
        B4[PromptBuilder + DynamicContext]
        B5[QueryProfiles]
        B6[HITL 权限]
        B7[MCP Manager]
    end

    subgraph 执行层
        C1[Agent agent.ts]
        C2[Claude Agent SDK]
    end

    subgraph 持久化层
        D1[SessionStore JSONL]
        D2[MemoryStore .zora/]
        D3[MemoryAgent]
    end

    A1 --> B1
    A2 --> B2 --> B1
    A3 --> B1

    B1 --> B3
    B3 --> B4
    B3 --> B5
    B5 --> B6
    B5 --> B7
    B3 --> C1

    C1 --> C2
    C2 -->|stream events| C1
    C1 -->|persist| D1
    C1 -->|onConversationEnd| D3
    D3 --> D2
```
