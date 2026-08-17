# 压缩在 App 重启与会话切换后的恢复设计

调研日期：2026-08-13

## 结论

压缩需要拆成两类状态管理：

- **持久状态**：最近一次已经提交的 Pi compaction entry、压缩边界、压缩次数、压缩后上下文估算、最近一次可靠 usage。
- **瞬时运行状态**：`compaction_start`、正在生成摘要、当前 AbortController、当前 Agent Turn 是否仍在运行。

App 重启后只恢复持久状态。`compacting` 不能跨进程恢复为“仍在压缩”。会话切换时，如果原会话的 Runtime 仍在同一进程内运行，则继续显示该会话的实时状态；Runtime 已结束或进程已经重启时，从 Pi checkpoint 和产品会话重新派生状态。

推荐行为如下：

| 场景 | Runtime 行为 | UI 行为 | 下一次 Agent Turn |
|---|---|---|---|
| 压缩完成后重启 App | 重新打开同一 Pi JSONL，使用最新 compaction entry 重建上下文 | 显示最近一次已提交的用量和压缩次数，状态为 ready | 直接在摘要、保留尾部和压缩后消息之上继续 |
| 会话切换后再回来，原 Turn 仍在运行 | 不销毁该会话 Runtime，流继续按 workspaceId、sessionId 路由 | 恢复该会话的实时 running/compacting 状态 | 当前 Turn 继续，直到 `agent_settled` |
| 会话切换后再回来，原 Turn 已结束 | 从持久消息和 Pi checkpoint 派生 | 显示 ready；最近一次成功边界可查看，不显示持续运行 | 新 Turn 继续使用同一 checkpoint |
| 压缩过程中正常关闭 App | 先 abort 压缩，再进行有时限的 shutdown | 下次启动显示“上次任务已中断”，不显示“压缩中” | 保留关闭前最后一个已提交边界；达到阈值时重新压缩 |
| 压缩过程中进程崩溃或强制退出 | 未写入 compaction entry 时回滚到旧边界；已写入时视为压缩已提交 | 清理残留瞬时状态，依据 Pi JSONL 是否存在新 compaction entry 判断结果 | 不自动重放上一条用户任务；用户继续后从最后一个已提交 checkpoint 运行 |

Zora 当前 `ContextWindowState.status` 会写入产品 SessionMeta。若退出发生在 `status="compacting"` 之后、`compaction_end` 之前，重启会恢复出永久的“压缩中”。建议将 `status` 改为运行期派生字段，或在 App 启动和会话加载时把所有没有活跃 Runtime 对应的 `compacting` 归一化为 `ready`。Pi checkpoint 是模型上下文的事实来源，产品 SessionMeta 只保存 UI 投影和统计缓存。

## 调研版本

- Proma：`origin/main@3b749f1aded87c02e7ef0921dc43fc5ebc881dfd`，2026-08-13。当前工作区本地 `main` 有自有提交且落后远端，因此本文通过 `git show origin/main:<path>` 核对最新远端代码。
- Pi：`origin/main@46bb9a2c3bdb296b0d2179f7309ec6b79a7f3106`，2026-08-13，包版本 `0.84.1`。
- Proma 依赖 Pi `0.82.1`，并维护本地 Pi patch。Proma 与 Pi 主仓的恢复语义需分别判断。
- Claude Agent SDK：Zora 仓库内的第一方官方文档镜像 `claude_agent_sdk_ref/`。

引用 Proma、Pi 最新远端源码时，路径前缀均为本机绝对仓库路径，行号对应上述 `origin/main` 提交。

## Pi 的持久化与恢复语义

### Compaction entry 是提交边界

Pi 的 `CompactionEntry` 保存：

- `summary`
- `firstKeptEntryId`
- `tokensBefore`
- 可选的 `details`、摘要生成 usage 和 `fromHook`

来源：`/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/session-manager.ts:69-80`。

SessionManager 使用 append-only JSONL。每个 entry 带 `id` 和 `parentId`，当前 leaf 表示当前分支位置。追加 entry 时，Pi 先更新内存索引，再以一条完整 JSONL 记录追加到文件：

- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/session-manager.ts:844-853`
- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/session-manager.ts:1015-1049`
- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/session-manager.ts:1096-1118`

自动压缩和手动压缩都在摘要生成完成、AbortSignal 再次确认未取消之后，才调用 `appendCompaction()`。随后才重建 agent messages 并发送 `compaction_end`：

- 手动压缩：`/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/agent-session.ts:1853-1916`
- 自动压缩：`/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/agent-session.ts:2125-2186`

由此可以确认：

1. 进程在摘要生成阶段退出，JSONL 中没有半完成 compaction entry，旧上下文仍然有效。
2. `appendCompaction()` 已完成后退出，新边界已提交。即使产品层尚未收到 `compaction_end`，下次打开仍会使用新边界。
3. Pi 没有持久化“压缩进行中”的状态。AbortController 和 `isCompacting` 都是进程内状态。

### loadSession 如何重建压缩后的上下文

`SessionManager.open()` 读取 JSONL，跳过无法解析的行，重建 entry 索引，并把文件最后一个 entry 设为 leaf：

- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/session-manager.ts:300-313`
- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/session-manager.ts:895-927`
- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/session-manager.ts:958-977`

恢复上下文时，Pi 沿当前 leaf 的 parent 链构造分支，找到最新 compaction entry，生成：

1. 最新摘要消息。
2. `firstKeptEntryId` 开始的保留尾部。
3. compaction entry 之后的新 entries。

更早的原始 entries 继续保存在 JSONL，但不会进入模型上下文：

- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/session-manager.ts:334-359`
- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/session-manager.ts:379-469`

创建 `AgentSession` 时，SDK 直接调用 `buildSessionContext()`，恢复 messages、模型和 thinking level：

- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/sdk.ts:171-232`

这套机制同时覆盖 App 重启和会话切换后的新 Runtime 实例。产品层无需重新生成压缩摘要。

Pi 对用量恢复也提供了明确口径：如果最新 compaction boundary 之后还没有有效 assistant usage，`getContextUsage()` 返回 `tokens: null, percent: null`；收到新的真实 assistant usage 后才重新计算百分比：

- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/agent-session.ts:3174-3217`

因此，压缩完成后可以立即展示 `estimatedTokensAfter`，但应标识为估算。App 重启后不能继续把压缩前百分比显示为精确值。

### 压缩中退出后的边界

Pi `dispose()` 会中止 retry、compaction、branch summary、bash 和 agent run。`abortCompaction()` 会同时取消手动和自动压缩：

- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/agent-session.ts:835-856`
- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/agent-session.ts:1935-1941`

正常关闭 App 时应先停止接收新任务，然后调用 Runtime dispose。由于摘要完成前不会落 compaction entry，取消后的恢复结果等同于回到最近一次已提交边界。

下一次发送用户消息之前，Pi 会检查尾部 assistant usage。关闭前已经接近阈值时，可以再次触发压缩：

- `/Users/bytedance/Desktop/03-code/github_ref/pi (origin/main@46bb9a2c):packages/coding-agent/src/core/agent-session.ts:1205-1210`

Pi 不会在进程重启后自动继续被中断的 Agent Turn。该行为适合作为默认安全策略，因为自动重放用户任务可能重复执行写文件、发消息或外部 API 等副作用。需要跨进程自动续跑时，应另行设计 execution journal、工具幂等键和明确的 continuation checkpoint；仅依赖 compaction summary 不足以保证副作用安全。

## Proma 最新实现

### 会话重启与切换

Proma 在产品会话 meta 中保存 `sdkSessionId` 和 `piSessionFile`。启动一个新的 Adapter run 时，它用 `resumeSessionId` 查找 JSONL，再调用 `SessionManager.open()`；找不到 artifact 会明确报错：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma (origin/main@3b749f1a):apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1305-1317`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma (origin/main@3b749f1a):apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1489-1491`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma (origin/main@3b749f1a):apps/electron/src/main/lib/agent-session-manager.ts:529-545`

因此，Proma 的 App 重启和会话切换都依赖 Pi transcript 恢复模型上下文。产品消息 JSONL负责 UI 历史，Pi JSONL负责 Runtime 上下文。

前端切换会话时，Proma 先读缓存，再从磁盘加载该产品会话的完整 SDKMessage 列表。会话仍在运行时不清理 stream state；已经空闲时清理流式展示字段并保留 usage 和 compaction 结果：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma (origin/main@3b749f1a):apps/electron/src/renderer/components/agent/AgentView.tsx:1143-1210`

这形成了合理的两层恢复：同一进程内使用实时流状态，跨进程使用产品消息和 Pi artifact。

### 产品级 compact boundary

Proma 把 Pi 事件转换为产品 SDK system message：

- `compaction_start` 转为 `subtype: compacting`。
- 成功的 `compaction_end` 转为 `subtype: compact_boundary`，包含 summary。
- 取消、失败和 noop 转为带终态的 status message。

来源：`/Users/bytedance/Desktop/03-code/github_ref/Proma (origin/main@3b749f1a):apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1663-1705`。

这些 SDKMessage 逐条追加到产品 JSONL，重新进入会话时会被完整加载：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma (origin/main@3b749f1a):apps/electron/src/main/lib/agent-session-manager.ts:430-448`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma (origin/main@3b749f1a):apps/electron/src/main/lib/agent-session-manager.ts:500-519`

UI 从产品消息和当前 stream atom 两处派生压缩状态。最新成功 boundary 会显示“上下文已压缩”；出现后续 assistant、user 或普通 system message 后，旧的压缩状态停止占用当前进度区域：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma (origin/main@3b749f1a):apps/electron/src/renderer/components/agent/AgentMessages.tsx:96-181`

上下文用量也可从持久化 result 或 assistant usage 反向扫描获得：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma (origin/main@3b749f1a):apps/electron/src/main/lib/agent-session-usage.ts:45-90`

### Proma 的异常退出缺口

Proma 将 `compacting` 作为产品消息持久化。UI 在没有后续终态时，会把持久化的 `compacting` 重新派生为 running：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma (origin/main@3b749f1a):apps/electron/src/renderer/components/agent/AgentMessages.tsx:106-125`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma (origin/main@3b749f1a):apps/electron/src/renderer/components/agent/AgentMessages.tsx:150-179`

如果 App 在 `compaction_start` 与 `compaction_end` 之间强制退出，产品 JSONL 留下 `compacting`，Pi JSONL通常没有新 compaction entry。当前代码片段中没有看到 App 启动时对该悬空状态执行 liveness reconciliation。Proma 的 session resume 设计可以正确恢复 Runtime 上下文，但 UI 可能持续显示“正在整理上下文”。Zora 不应复制这部分行为。

## Claude Agent SDK 的官方语义

Claude Agent SDK 在 init system message 中返回 `session_id`。后续用 `resume` 传回该 ID，SDK自动加载历史和上下文：

- `/Users/bytedance/Desktop/03-code/ZoraAgent/claude_agent_sdk_ref/Session Management.md:9-49`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/claude_agent_sdk_ref/Session Management.md:83-127`

官方文档将压缩完成表示为 `CompactBoundaryMessage` 或 `system/compact_boundary`。`/compact` 调用只有收到 compact boundary 后才能视为完成：

- `/Users/bytedance/Desktop/03-code/ZoraAgent/claude_agent_sdk_ref/Stream responses in real-time.md:130-136`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/claude_agent_sdk_ref/Slash Commands in the SDK.md:83-119`

Claude SDK 与 Pi 的共同模式是：session ID 或 transcript artifact负责跨请求恢复，compact boundary 表示已经提交的压缩结果。官方文档没有承诺在宿主进程退出后自动续跑一个正在执行的 Agent Turn。因此 Zora 对 Claude 路径也应采用“恢复已提交会话上下文，不恢复进程内压缩任务”的口径。

## Zora 推荐设计

### 1. 状态模型

建议把当前 `ContextWindowState` 拆成持久部分与运行部分。

持久部分，可继续保存在产品 SessionMeta：

```ts
interface PersistedContextWindowState {
  usedTokens: number
  contextWindow: number
  thresholdTokens: number
  compactionCount: number
  lastCompactedAt?: string
  lastCompactionEntryId?: string
  updatedAt: string
}
```

运行部分，只保存在 Runtime registry 或 renderer stream state：

```ts
interface RuntimeCompactionState {
  status: "idle" | "compacting"
  workspaceId: string
  sessionId: string
  runId: string
  startedAt?: string
}
```

如果暂时不拆类型，最低改动为：

1. 仍可短暂写入 `status: compacting`，用于崩溃诊断。
2. App 启动、workspace 加载、session 激活时查询 Runtime registry。
3. 找不到同 session 的活跃 run 时，将持久化 `compacting` 归一化为 `ready`。
4. 前端只在 `RuntimeCompactionState.status === compacting` 时显示旋转状态。

前一种设计的状态所有权更清楚，也避免 SessionMeta 被运行期事件频繁写盘。

### 2. checkpoint 与 UI 投影的事实来源

建议按以下优先级恢复：

1. **模型上下文**：Pi SessionManager JSONL。
2. **用户可见历史**：产品会话 JSONL。
3. **实时运行状态**：Main 进程的 Runtime registry，键为 `(workspaceId, sessionId)`。
4. **上下文用量 UI**：优先使用当前 Runtime 的 usage；空闲和重启后使用 SessionMeta 缓存，并依据 Pi 最新 compaction entry进行校验。

产品 SessionMeta 中可以保存 `lastCompactionEntryId` 或 compaction entry timestamp。会话打开时：

- ID 与 Pi 最新 entry 一致，直接使用缓存。
- Pi entry 更新但产品 meta 尚未更新，说明退出发生在 Pi commit 与产品事件持久化之间；从 Pi 上下文重新估算 token，补写产品 meta。
- 产品 meta 声称已压缩但 Pi entry不存在，丢弃该 UI boundary，继续使用 Pi checkpoint。

这允许处理跨两个 JSONL 的短暂提交窗口，同时保持 Pi 为 Runtime 上下文的唯一事实来源。

### 3. App shutdown

建议关闭流程：

1. 停止接收新的 prompt、steer、follow-up 和 compact 请求。
2. 标记所有 active run 为 stopping。
3. 对 Pi session 调用 `abortCompaction()` 和 `abort()`，随后 `dispose()`。
4. 设定较短的总 shutdown deadline，避免 Electron 无法退出。
5. 将仍为 running/compacting 的产品 Turn 标记为 interrupted；不伪造 compaction failure，也不伪造 compact boundary。
6. 下次启动统一清除无活跃 Runtime 对应的瞬时状态。

不要等待摘要生成自然结束后才允许关闭 App。关闭动作应有确定上限，Pi 的 append-after-summary 已经提供事务边界。

### 4. 会话切换

会话切换不等于停止任务：

- 保留原会话的 active Pi session 和订阅。
- 每个事件携带原始 `workspaceId`、`sessionId`、`runId`，不能使用切换后的当前 workspace 推断归属。
- 返回会话时，先查询 Main 进程 Runtime registry，再结合缓存与持久化消息渲染。
- 原会话已经 idle 时，可以释放 AgentSession 实例；下一轮通过同一 Pi JSONL重新创建。

如果产品只允许单会话前台运行，则切换会话应显式中止原 Turn，并写入 interrupted 状态。不要静默 dispose 后继续显示 running。

### 5. 上一轮被压缩中断后的继续策略

App 重启后不自动重放旧 prompt，也不自动调用 `agent.continue()`。原因包括：

- 退出前的工具调用可能已经产生副作用。
- Pi 的进程内 continuation state、queued messages 和 AbortController 没有持久化。
- compaction entry只描述模型上下文边界，不等于 execution checkpoint。

产品可以显示“上次任务在压缩期间中断，可以继续”，用户点击后发送一个明确的新 Turn。若未来要求完全自动续跑，需要单独增加 Run/ExecutionAttempt 持久化、工具幂等键和可恢复 continuation checkpoint。

## 验收场景

建议新增以下 E2E 或故障注入用例：

1. **压缩完成后重启**：成功 compaction，完全退出 Electron，重新打开同一会话，确认 badge 为 ready、compactionCount 保持、后续问答能使用摘要中的标记。
2. **切换会话再返回**：A 会话压缩中切到 B，A 在后台完成；返回 A 后显示成功状态，后续消息继续使用 A 的 Pi checkpoint。
3. **摘要生成阶段强制退出**：收到 `compaction_start` 后终止 Electron；重启确认不显示永久“压缩中”，Pi JSONL没有新增 boundary，下一轮可重新触发压缩。
4. **Pi commit 后、产品 meta 前强制退出**：在 `appendCompaction()` 后故障注入；重启从 Pi entry补齐 UI meta，不重复压缩旧区间。
5. **中断任务不自动重放**：压缩前执行一个可计数工具，强制退出后重启，确认工具没有被自动再次执行。
6. **后台事件归属**：A 会话运行时切换 workspace，确认 usage、compaction 状态和最终消息仍更新到 A 的 workspace/session。

## 最终建议

Zora 当前的 Pi JSONL 目录与 session-level compaction方向可以保留。下一步重点是恢复协议：

1. 将 `compacting` 定义为纯运行期状态，重启不恢复。
2. 用最新 Pi compaction entry校验产品 SessionMeta。
3. 会话切换时保持 active Runtime，不丢订阅，不改变事件归属。
4. App 关闭时有界 abort，未提交摘要自动回滚到上一个 Pi boundary。
5. 重启后不自动继续旧 Agent Turn，交由用户显式继续。
6. 新增覆盖 crash window 的故障注入 E2E。

这套规则同时符合 Pi append-only checkpoint、Proma 的双持久化 resume 结构，以及 Claude Agent SDK 的 session resume 和 compact boundary 语义。
