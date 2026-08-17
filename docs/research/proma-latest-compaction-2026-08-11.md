# Proma 最新压缩与上下文连续性设计

日期：2026-08-11

## 结论

Proma 当前采用四组机制：

1. Pi 原生阈值压缩，触发点提前到模型窗口的 80%。
2. Pi 0.82.1 的原生 overflow compaction 和同 transcript `agent.continue()`，Proma 在产品适配层延迟终态，等待 Runtime 完成恢复。
3. Proma 自定义 `CompactContext` 工具，要求模型先写 durable handoff，再结束当前内部 loop，执行 `session.compact()`，随后用一条内部 continuation prompt 开始新的 Pi prompt。
4. Proma 产品会话与 Pi transcript 双持久化。产品会话保存用户可见消息和 compaction summary，Pi transcript 保存可恢复的树状执行历史。两者通过 `sdkSessionId`、`piSessionFile` 和 assistant UUID 到 Pi entry ID 的绑定关联。

当前 Proma 仍锁定 `@earendil-works/pi-*` 0.82.1。它的 overflow 判定只覆盖明确的 prompt-too-long、输入 token 超过窗口，以及 `stopReason: length + output=0 + input>=99% window`。它没有覆盖 Zora 现场中的 `length + 少量 output + output 低于模型 maxTokens`。因此，Proma 最新实现不能替代新版 Pi 的 recoverable-length 修复。

对 Zora 的建议：采用新版 Pi 原生 recoverable-length 恢复、80% 阈值和 terminal gate。不要复制 Proma 0.82.1 的长度启发式分类器，也不要把 Proma 主动 `CompactContext` 的 continuation prompt 用于修复 Runtime length 截断。主动压缩可以作为后续独立能力评估。

## 1. 当前版本与相关提交

### 1.1 工作树状态

检查时 Proma 本地仓库状态为：

- 当前分支：`main`
- `HEAD`：`d3bef6b7555f6194a91398278fca69da23cbcf56`
- `origin/main`：`a48d32209007f571b56710601655c418d096fc57`
- 本地 `main` 比 `origin/main` 多一个 `支持channel ID` 提交。该提交与 compaction 无关。
- 最近发布标签：`v0.17.1`。

Pi 依赖仍全部锁定为 0.82.1，并对 `pi-ai` 和 `pi-coding-agent` 使用 Bun patch：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/package.json:36-43`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/bun.lock:41-43`

### 1.2 最近相关提交

| 日期 | 提交 | 内容 |
| --- | --- | --- |
| 2026-07-22 | `d7485da4` | 增加当前会话 `CompactContext` 工具及产品侧压缩状态展示 |
| 2026-07-27 | `e432f883` | 主动压缩后自动继续原始任务，最多 20 次 |
| 2026-07-28 | `63f60c0d` | 加强 Pi native retry 生命周期、整轮预算、terminal gate 和 UI 状态 |
| 2026-07-28 | `e5fd4152` | 自动压缩触发点调整到上下文窗口约 80% |
| 2026-08-03 | `9a079aa8` | 增加 Pi context overflow 终态门控，等待 compaction/continue 完成 |
| 2026-08-04 | `351ebab2` | 前五次 native retry 对 UI 静默 |
| 2026-08-10 | `39de131d` | 手动压缩改为二次点击确认，增加压缩交互状态 |

其中 8 月 3 日以后的 compaction 核心逻辑没有新的 Runtime 语义变更。8 月 10 日的更新集中在手动压缩按钮交互。当前组件仍把自动压缩阈值用于警告颜色，并提供手动压缩入口：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/ContextUsageBadge.tsx:1-9`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/ContextUsageBadge.tsx:18-30`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/ContextUsageBadge.tsx:220-233`

## 2. 阈值与自动压缩

Proma 将自动压缩目标比例定义为 0.8。`reserveTokens` 按窗口的 20% 计算：

```text
reserveTokens = ceil(contextWindow * 0.2)
threshold = contextWindow - reserveTokens
```

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/utils/pi-compaction.ts:1-20`

创建 Pi session 时，Proma 先使用模型的真实 `contextWindow`，缺失时才使用默认值，然后将计算结果交给 Pi `SettingsManager`：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1234-1249`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1267-1285`

模型窗口还会回传给产品层。Proma 会把 Runtime 返回值与按模型名称推断的窗口取较大值，供 UI 使用：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1412-1415`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1340-1349`

Pi 0.82.1 在每个底层 agent loop 结束后检查 compaction。threshold compaction 生成摘要并重建 `agent.state.messages`，但 `willRetry=false`。没有等待中的 queued message 时，本次 `session.prompt()` 结束：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:801-826`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1603-1631`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1719-1754`

因此，80% 阈值降低了在长工具链末端触及窗口上限的概率，但它仍然属于 post-run 检查。单个 agent loop 在两次检查之间仍可能消耗大量上下文。

## 3. Overflow、recoverable length 与 native retry

### 3.1 Pi 0.82.1 的 overflow 恢复

Proma 当前依赖的 Pi 0.82.1 在 `_handlePostAgentRun()` 中按以下顺序处理：

1. 尝试瞬时错误 native retry。
2. 检查 compaction。
3. 任一处理返回 `true` 时，外层调用 `agent.continue()`。

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:774-826`

overflow compaction 会：

- 确认消息来自当前模型。
- 避免使用旧 compaction boundary 之前的 assistant usage 重新触发压缩。
- 从 active state 移除失败 assistant。
- 生成 summary 并追加 compaction entry。
- 用 `SessionManager.buildSessionContext()` 重建 active messages。
- `willRetry=true` 时返回 `true`，由 `_runAgentPrompt()` 调用 `agent.continue()`。
- 同一 overflow recovery 只允许一次。

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1553-1602`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1652-1750`

这条恢复路径保持在同一个 Pi prompt 和同一个 transcript 内，没有追加新 user message。已经持久化的 tool result 可以继续使用。

### 3.2 当前长度判定范围

Proma 0.82.1 的 `isContextOverflow()` 仅把以下 `length` 识别为 overflow：

```text
stopReason == length
usage.output == 0
usage.input + usage.cacheRead >= contextWindow * 0.99
```

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/node_modules/@earendil-works/pi-ai/dist/utils/overflow.js:124-153`

Proma adapter 为 terminal gate 重复使用了相同的 `output=0 + 99%` 长度启发式：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:637-668`

当前代码和 patch 中没有 `isRecoverableLength`、`desiredMaxOutput` 或等价判断。因此，以下情况不会被 Proma 识别为 native overflow recovery：

```text
stopReason == length
0 < usage.output < model.maxTokens
```

这正是 Zora 已观察到的场景。模型产生了一部分 reasoning/output，但由于输入上下文压力，实际输出明显低于配置的最大输出。Proma 最新主线仍可能把它归入普通 threshold compaction，随后结束当前 prompt。

### 3.3 瞬时错误 native retry

Proma 对 Pi 0.82.1 维护本地 patch，保留 `agent.continue()`，并增加：

- 连续失败段重试次数。
- 单次顶层 prompt 的累计重试次数。
- 累计退避时间。
- `auto_retry_start` 与实际请求开始事件 `auto_retry_attempt_start` 的区分。
- 成功、耗尽、取消三种结束状态。

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/patches/@earendil-works%2Fpi-coding-agent@0.82.1.patch:79-90`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/patches/@earendil-works%2Fpi-coding-agent@0.82.1.patch:94-142`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/patches/@earendil-works%2Fpi-coding-agent@0.82.1.patch:145-171`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/patches/@earendil-works%2Fpi-coding-agent@0.82.1.patch:186-249`

Proma 配置为单段最多 8 次、整轮最多 8 次、累计退避最多 5 分钟，并禁用 provider 层嵌套重试。设计文档明确要求使用同 transcript `agent.continue()`，避免外层重放原始 prompt 后重复执行已有副作用：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/docs/plans/2026-07-28-pi-retry-policy-design.md:3-11`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/docs/plans/2026-07-28-pi-retry-policy-design.md:17-24`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1267-1283`

前五次 native retry 不显示给用户，但终态错误仍会展示：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-retry-control.ts:3-4`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-retry-control.ts:93-110`

## 4. Terminal gate

Pi 先发 `message_end` 和 `agent_end`，随后在 `_handlePostAgentRun()` 中决定 retry 或 compaction。Proma 因此没有把 assistant error 或 result 立即作为产品终态。

通用 retry gate 只有三个操作：

- `defer(error)` 暂存 provisional error。
- `peek()` 查看但不释放。
- `settle(willRetry)` 在无需恢复时释放，恢复时丢弃。

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-retry-control.ts:42-68`

adapter 的事件处理为：

- `message_end` 遇到 error 或可能的 overflow 时暂存 assistant terminal，并保留同一 UUID。
- `agent_end.willRetry=true` 时不向外层发送终态。
- 可能的 overflow 即使 `agent_end.willRetry=false`，仍继续等待后续 `compaction_end`，因为 Pi 在 `agent_end` 后才做 overflow 判定。
- `compaction_end(reason=overflow, willRetry=true)` 后丢弃 provisional error。
- compaction 失败时释放原错误。
- `agent_settled` 作为缺少 `compaction_end` 时的防御性收束点。
- 普通 `agent_end` 产生的 result 也暂存到 `session.prompt()` 完成后，避免外层过早释放 session。

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1423-1462`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1472-1524`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1526-1564`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1588-1634`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1735-1744`

这部分设计可以直接复用于 Zora 的产品事件边界。判定条件应由新版 Pi 的公开 `willRetry` 事件驱动，产品层不应重复实现 Runtime 的 recoverable-length classifier。

## 5. 主动 CompactContext 与 durable handoff

Proma 的 `CompactContext` 属于模型主动切分长任务的能力。

### 5.1 调用约束

工具 schema 明确要求：

- 只压缩当前 Pi session。
- 调用前将 durable handoff 或 checkpoint 写入会话工作台或项目文件。
- 当前内部 agent loop 结束后再压缩。
- 压缩后自动继续原始任务。

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:690-718`

工具结果带 `terminate: true`，避免 active loop 与 `session.compact()` 竞争。Proma 还拦截混合工具批次，要求 `CompactContext` 单独调用：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:601-607`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:633-635`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:670-687`

### 5.2 压缩与续跑

`session.prompt()` 正常结束后，如果工具设置了 `compactContextRequested`，Proma 调用原生 `session.compact()`。成功或 noop 后，它计划一个 continuation prompt：

```text
依据压缩摘要、保留的最近上下文和已持久化的交接状态继续；
先核验当前状态；
避免重复已经完成或已提交的操作；
原始任务完成后再输出最终答复。
```

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:610-630`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:738-759`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1710-1733`

续跑使用新的 `session.prompt()`，因此会在 Pi transcript 中新增一条内部 user message。Proma 跳过 skill expansion，避免内部 continuation 再次展开用户提及的 Skill。自动 continuation 上限为 20 次，并受 abort 和 Runtime budget 限制：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:93`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:618-630`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1678-1702`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1751-1766`

这条路径适用于模型主动完成阶段切分。Runtime length/overflow 恢复仍使用 Pi 内部 `agent.continue()`。两条路径不能合并为一个机制。

### 5.3 Durable handoff 的载体

Proma system prompt把会话工作台定义为当前任务的 todo、plan、handoff、临时笔记和中间产物存放位置；项目 Context 用于需要跨会话交付的长调研、设计和 checklist：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-prompt-builder.ts:42-70`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-prompt-builder.ts:113-136`

Proma 没有为 handoff 定义单独的结构化数据库 schema，也没有在 `CompactContext` 调用前校验 handoff 文件确已写入。当前约束主要由 system prompt 和工具 description 执行。因此，durable handoff 是一个操作规范，强一致性由模型行为承担。

## 6. 产品会话与 Pi transcript

Proma 同时保存两份数据：

| 数据 | 位置与用途 |
| --- | --- |
| Proma 产品会话 JSONL | 用户可见历史、UI 渲染、跨 Runtime 恢复入口 |
| Pi session JSONL | Pi 树状执行历史、tool result、compaction entry、原生 resume/fork/rewind |
| 会话元数据 | `sdkSessionId`、精确 `piSessionFile`、assistant UUID 到 Pi entry ID 映射 |

元数据定义：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/agent.ts:640-665`

正常续聊时，Proma 根据 `sdkSessionId` 定位 Pi session 文件，并用 `SessionManager.open()` 恢复。创建 session 后会保存真实 `sessionId` 和 `sessionFile`：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1234-1242`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1412-1415`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1306-1329`

Proma 还在 Pi message 持久化完成后按对象身份找到 entry ID，并保存 UI UUID 映射，供 fork/rewind 使用：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1433-1445`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1410-1417`

产品会话保存原始用户消息。Pi 运行期间生成的普通 user text 不回写产品会话，只有 tool result user message保留：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:530-539`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:592-598`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:477-527`

compaction 时，Proma 把 Pi summary 转成产品 `compact_boundary` system message，并将其列为可持久化消息：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1579-1625`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/utils/agent-system-message.ts:3-21`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:489-510`

当前产品 boundary 保存了 `summary`。只有手动压缩会额外保存 `estimatedTokensAfter`。`reason`、`tokensBefore`、`firstKeptEntryId`、`willRetry` 和 Runtime artifact 标识没有进入产品 system message：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1597-1608`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/agent.ts:275-294`

Pi artifact resume 失败时，Proma 会创建新的 Pi session，并在 prompt 中注入当前产品会话引用，引导模型通过 session-cleaner 读取完整产品历史。普通无 resume 的新 session 只内联最近 20 条消息，同时要求长任务先读取完整产品历史：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-session-context-prompt.ts:4-16`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-session-context-prompt.ts:88-143`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-session-context-prompt.ts:145-173`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:410-475`

该恢复方式保留产品历史的可读性，但模型需要额外工具读取历史，且产品 compact boundary 缺少 Pi 的 retained-tail 边界信息。它不能完整重建原 Pi active context。

## 7. Dynamic Context 是否持久化

Proma 的 dynamic context 包含：

- 当前时间。
- 工作区名称。
- MCP server 列表和启用状态。
- 当前工作目录。

来源：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-prompt-builder.ts:160-205`

编排层把 dynamic context 与用户输入拼成 `contextualMessage`，然后将其作为 `session.prompt()` 的输入：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:920-964`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:1352-1371`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts:1678-1711`

因此，dynamic context 会作为 user message 持久化到 Pi transcript。注释中的仅影响 prompt、不影响持久化，指的是 Proma 产品会话只保存 `rawUserMessage`，不包含 mention 注入和 dynamic context：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:926-945`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:530-539`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-orchestrator.ts:592-598`

Proma 已通过另一项设计降低重复成本：它没有把完整 memory 文件内容放进每轮 dynamic context。system prompt只给出 memory、AGENTS.md、Context 和会话工作台的路径，由模型按需读取：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-prompt-builder.ts:113-136`

结论：Proma 没有解决 dynamic context 在 Pi transcript 中重复持久化的问题，但其重复内容体积较小。Zora 当前把 USER.md、MEMORY.md 和近期日志全文拼入每轮 dynamic context，不能直接以 Proma 的现状证明该做法合理。

## 8. 对 Zora 最新 main 的复用建议

### 8.1 建议采用

#### A. 80% 自动压缩阈值

采用模型真实 `contextWindow` 计算 `reserveTokens`，避免统一写死窗口。Proma 的计算函数足够简单，Zora可以用同一公式实现，无需引入额外抽象。

#### B. Runtime 原生恢复，产品终态门控

产品层应：

- 暂存 provisional assistant terminal。
- `agent_end.willRetry=true` 时保持当前产品 turn 运行中。
- 等待 `compaction_end` 和最终 `agent_settled`。
- 恢复成功后丢弃被 Runtime 移除的截断或错误 assistant。
- 恢复失败后释放明确终态。

Proma terminal gate 的状态边界可以复用。Zora mapper 现有的 provider-error 延迟逻辑可以沿这个方向收敛。Runtime recoverable-length 判定交给升级后的 Pi。

#### C. 产品级 compaction boundary

Proma 已验证 summary 可以作为产品可见、可持久化的 system boundary。Zora 可以采用同类隐藏事件，但字段应更完整：

```text
summary
reason
tokensBefore
estimatedTokensAfter
firstKeptEntryId 或 Runtime-neutral retained-tail cursor
willRetry
runtimeArtifactId
createdAt
```

其中 Pi entry ID 只能用于同一 Pi artifact。面向跨 Runtime 恢复时，还需要产品会话自己的 tail cursor。

#### D. Durable handoff 规范

对于跨多个压缩周期、包含外部副作用的任务，要求在会话工作台保存目标、完成项、资源标识、待办和验证状态。Proma 对文件路径和任务边界的定义可以作为提示词参考。

#### E. 区分两类 continuation

| 场景 | 继续方式 |
| --- | --- |
| Runtime error、overflow、recoverable length | Pi 内部 `agent.continue()`，同一 prompt，不新增 user message |
| 模型主动 `CompactContext` 阶段切分 | `session.compact()` 后由产品启动新的内部 prompt，可以新增 continuation user message |

这个边界应在 Zora 的设计和测试中明确。

### 8.2 不建议复制

#### A. Proma 0.82.1 的长度启发式

`output=0 + input>=99%` 覆盖范围过窄。升级 Pi 后使用 SDK 原生 `isRecoverableLength(message, desiredMaxOutput)` 语义，避免产品层维护第二套 classifier。

#### B. 用 continuation prompt 修复 length 截断

Proma continuation prompt专用于主动 `CompactContext`。它会新增 user message并开始新的 Pi prompt。用于 Runtime length 恢复时会改变 turn 边界，并增加重复工具副作用的风险。

Zora 最新 main 中 `pi-session-bridge.ts` 的 `emptyLengthRecoveryPending -> followUp()` 与此目标不匹配：

- `/Users/bytedance/Desktop/03-code/ZoraAgent/src/main/runtime/pi-session-bridge.ts:288-314`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/src/main/runtime/pi-session-bridge.ts:325-341`

此外，Pi idle 状态下 `followUp()` 只入队，后续没有 active agent loop 时无法保证被消费。该逻辑应在升级 Pi 后删除。

#### C. 继续将完整 Zora memory 放进每轮 user prompt

Zora 当前 dynamic context读取 USER.md、MEMORY.md 和最近两天日志，并与用户 prompt 一起交给 `session.prompt()`：

- `/Users/bytedance/Desktop/03-code/ZoraAgent/src/main/prompts/zora-dynamic-context.ts:69-116`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/src/main/prompts/zora-dynamic-context.ts:119-124`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/src/main/runtime/pi-session-bridge.ts:331-335`

Proma 的可复用做法是只在 system prompt 提供稳定路径，按需读取内容。时间、时区、cwd 等实时信息可以使用非持久化 context transform 或每次重建的 system append。

#### D. 复制 Proma 的 Pi 0.82.1 patch

Proma patch解决 native retry 预算和事件语义，但会增加对旧版 dist 文件的长期维护成本。Zora 应优先升级到包含 recoverable-length 修复的 Pi 版本，再评估新版已覆盖的 retry 能力。只有明确缺失且有测试证明时，才保留最小 patch。

#### E. 依赖模型自行写 handoff

Proma 只通过工具 description 要求 durable handoff，没有验证文件或结构化状态已写入。Zora若引入主动压缩，应先决定 handoff 的最小 schema 和可验证载体，避免在没有 checkpoint 的情况下执行压缩。

## 9. 建议的 Zora 实施顺序

1. 升级 Pi 三项包到包含通用 recoverable-length 恢复的同一版本。
2. 删除 bridge 的 `emptyLengthRecoveryPending` 和 idle `followUp()` 恢复逻辑。
3. 让产品 mapper 以 `willRetry`、`compaction_end`、`agent_settled` 驱动同一 Agent turn 的状态机。
4. 将自动压缩阈值提前到 80%，并让 `contextWindow` 来自模型 capability。
5. 把 dynamic context 从 durable user message 中移出。完整记忆改为索引和按需读取。
6. 将 compaction boundary 作为产品级隐藏 checkpoint 持久化。
7. 增加真实 Pi 集成测试，覆盖 `recoverable length -> compaction -> agent.continue() -> single settled`，断言没有新增 user message和重复工具调用。
8. Runtime 恢复稳定后，再评估主动 `CompactContext` 与 durable handoff。

## 10. 验证缺口

Proma 当前仓库只保留 `pi-native-retry.test.ts`。此前 `CompactContext`、retry terminal gate 和 overflow recovery 的专项测试在后续提交中被删除。当前实现的行级行为可以从源码确认，但缺少覆盖最新组合状态机的持续回归测试。

Zora不应直接以 Proma 当前测试状态作为验收基线。最少需要真实 `AgentSession` 测试和用户可见 E2E，覆盖：

- threshold compaction 后正常结束。
- explicit overflow 后同 transcript continue。
- recoverable length 后同 transcript continue。
- compaction 失败后释放原终态。
- 用户在 compaction 中停止。
- 主动 CompactContext 写 handoff、压缩、内部续跑。
- 产品会话与 Pi transcript重启后仍保持一致。
