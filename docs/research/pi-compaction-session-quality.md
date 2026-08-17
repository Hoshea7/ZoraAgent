# Pi 会话上下文与 Compaction 机制研究

## 结论

Zora 当前安装的 `@earendil-works/pi-coding-agent` 为 0.82.1。该版本已具备会话树、结构化摘要、阈值压缩、显式上下文溢出后的单次压缩重试，但没有把一般的 `stopReason: "length"` 识别为可恢复的上下文压力。因此现场中的长度截断被归入普通阈值压缩，压缩完成后没有继续当前任务。

Pi 主仓当前版本为 0.84.1。2026-08-03 的提交 `32850ef7c`（`fix(coding-agent): resume after context-limited length stops (#7540)`）已经从 SDK 内部解决了同类问题：当 `length` 响应的实际输出低于模型原始 `maxTokens` 时，将其识别为可恢复截断，移除本次截断响应，执行 compaction，再通过 `agent.continue()` 恢复被中断的同一任务；同一触发条件最多恢复一次。

当前 Zora bridge 补丁不符合 `AgentSession.followUp()` 的实际语义。`followUp()` 只把用户消息加入队列；调用发生在 `session.prompt()` 已经结束、Agent 已进入 idle 之后，队列不会自行启动执行，紧接着的 `waitForIdle()` 会立即返回。该补丁还把恢复条件限制为“正文为空且无 tool call”，与 Pi 新版基于“实际输出低于原始输出上限”的判定存在差异。

建议的长期方案是升级 Pi 到包含 `32850ef7c` 的版本，并删除 bridge 中的长度截断续跑状态机。Zora 只负责展示 `agent_end.willRetry`、`compaction_start/end.willRetry`、`agent_settled` 等公开事件；当前 Agent turn 的继续执行由 SDK 内部完成。

## 版本范围

- Zora 锁定依赖：`package.json:37-39`，三项 Pi 包均为 0.82.1。
- Zora 实际安装包：`node_modules/@earendil-works/pi-coding-agent/package.json:3`，版本 0.82.1。
- 本地 Pi 主仓：`/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/package.json:3`，版本 0.84.1。
- 关键上游修复：Pi commit `32850ef7c5edff7a6eee0214516fbb7382bf292d`。

下文以 Pi 0.84.1 源码说明目标机制，并单列 0.82.1 的行为差异。

## 1. 每轮 prompt 如何构建历史

### 会话恢复

Pi 的持久化会话是 append-only tree。每个 entry 通过 `id`、`parentId` 形成路径，当前 leaf 决定有效分支。`SessionManager` 的职责及树语义见：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/session-manager.ts:844-854`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/session-manager.ts:334-359`

创建 `AgentSession` 时，SDK 调用 `sessionManager.buildSessionContext()`。若存在历史，则把解析后的 `existingSession.messages` 直接写入 `agent.state.messages`：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/sdk.ts:187-190`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/sdk.ts:362-374`

每次新的产品 prompt 只新增当前 user message，以及可选的 `nextTurn` custom messages。此前历史已经存在于 `agent.state.messages`：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:1212-1230`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:1271-1272`

### Provider 请求

底层 Agent 在每次模型调用前执行 `transformContext`，再执行 `convertToLlm`，最终请求由 system prompt、转换后的完整 active messages 和 tools 构成：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/agent/src/agent-loop.ts:277-312`

同一个 Agent run 内，每次 assistant response、tool result、steering message 都追加到 `currentContext.messages`；工具调用结束后，只要仍有工具调用或 steering/follow-up 消息，Agent loop 会继续发起模型调用：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/agent/src/agent-loop.ts:169-224`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/agent/src/agent-loop.ts:259-274`

因此，“跨 Agent turn 传递”的基础单位是 `agent.state.messages`。进程重启后由 SessionManager 重建；进程内则持续复用同一数组。

### Compaction 后的 active history

如果路径上存在 compaction，Pi 只选择最新 `CompactionEntry`、从 `firstKeptEntryId` 开始的保留历史、以及 compaction entry 之后的新 entries。更早的原始 entries 仍保存在 JSONL，但不再进入 provider context：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/session-manager.ts:410-453`

entry 到 runtime message 的投影规则为：

- 普通 user/assistant/toolResult message：原样传递。
- `custom_message`：投影为 custom Agent message，随后转换成 user message。
- `branch_summary`：投影为 branch summary message。
- `compaction`：投影为 compaction summary message。
- 普通 `custom`、label、session info、model/thinking change：不进入 LLM messages。

源码：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/session-manager.ts:379-408`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/session-manager.ts:461-469`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/session-manager.ts:94-140`

Compaction summary 最终转换为一个 user-role message，文本带有 `<summary>` 边界：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/messages.ts:11-17`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/messages.ts:176-183`

## 2. Compaction 触发时机与阈值

默认设置：

- `enabled: true`
- `reserveTokens: 16384`
- `keepRecentTokens: 20000`

源码：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/compaction.ts:126-136`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/settings-manager.ts:780-793`

阈值公式为：

```text
contextTokens > contextWindow - reserveTokens
```

源码：`/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/compaction.ts:232-238`。

`contextTokens` 优先使用 provider usage 的 `totalTokens`；没有该字段时累加 input、output、cacheRead、cacheWrite。若最后一条响应没有有效 usage，则基于最近一次有效 usage 加上其后消息的估算 token：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/compaction.ts:142-167`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/compaction.ts:198-229`

检查发生在两个位置：

1. `agent.prompt()` 整个底层 run 发出 `agent_end` 后，`_handlePostAgentRun()` 调用 `_checkCompaction()`。
2. 新 prompt 提交前再次检查上一条 assistant message，覆盖上次被 abort 的场景。

源码：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:1063-1104`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:1205-1210`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:1950-1962`

这意味着 0.82.1 的“普通阈值压缩”只能在一次底层 Agent run 结束后启动。一个由大量工具调用组成的长 run 可以在 run 内越过阈值，并继续增长到模型输出空间不足。现场正属于该时序。

Pi 的目标设计文档已把 threshold auto-compaction 定义为 run phase，并要求在 checkpoint 执行后继续 assistant loop；该 Harness v2 设计尚未全部落入当前 coding-agent 0.84.1 实现：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/agent/docs/harness-v2-state-machine.md:579-585`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/agent/docs/harness-v2-state-machine.md:733-737`

## 3. 压缩摘要包含哪些信息

默认 summary 的强制结构为：

- Goal
- Constraints & Preferences
- Progress，含 Done、In Progress、Blocked
- Key Decisions
- Next Steps
- Critical Context
- 精确文件路径、函数名和错误消息

源码：`/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/compaction.ts:467-537`。

summary 的输入会包含：

- user 文本
- assistant thinking
- assistant 正文
- assistant tool call 名称与参数
- tool result，单条最多保留 2000 字符
- previous summary，用于重复 compaction 时增量更新

源码：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/utils.ts:88-149`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/compaction.ts:642-678`

Compaction preparation 还包含：`firstKeptEntryId`、`messagesToSummarize`、split-turn prefix、`isSplitTurn`、`tokensBefore`、`previousSummary`、文件操作集合、settings：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/compaction.ts:692-708`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/compaction.ts:710-788`

切分时从最新消息向前累计，目标保留约 `keepRecentTokens`；可以在 user 或 assistant 等有效边界切分，不能从 tool result 开始。单个 turn 超过保留预算时，会额外生成 `Original Request / Early Progress / Context for Suffix` 的 turn-prefix summary：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/compaction.ts:387-460`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/compaction.ts:795-808`

最终 `CompactionEntry` 保存 summary、`firstKeptEntryId`、`tokensBefore`、生成 summary 的 usage、`details`、`fromHook`。默认 details 累积 `readFiles` 和 `modifiedFiles`：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/session-manager.ts:69-80`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/compaction/compaction.ts:904-918`

质量限制也很明确：工具结果超过 2000 字符会被截断；summary 是有损文本生成；保留历史只有约 20k tokens。因此 summary 的结构约束、关键状态文件化、最近工作保留共同决定长期会话质量。仅依赖自然语言 summary 无法保证所有事实无损传递。

## 4. Compaction 后如何继续当前任务

Pi 区分两类行为：

### Threshold compaction

普通阈值压缩传入 `willRetry: false`。压缩后重建 `agent.state.messages`，若没有等待中的 steering/follow-up，则本次 session prompt 结束；用户下一轮 prompt 使用“summary + kept tail + 新 user message”继续：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:2049-2051`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:2157-2161`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:2200-2203`

### Overflow 或可恢复 length

`willRetry: true` 时，Pi 从 agent state 移除失败或截断的 assistant message，完成 compaction，重建 state 后再次确认尾部没有恢复该响应，然后 `_handlePostAgentRun()` 返回 true，外层 `_runAgentPrompt()` 调用 `agent.continue()`。该路径没有新增 user prompt，语义上是继续被中断的当前任务：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:1993-2021`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:2188-2198`
- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:1063-1069`

低层 `continue()` 要求 transcript 尾部为 user 或 toolResult。尾部为 assistant 时，只有待处理的 steer/follow-up 能启动新 run，否则会拒绝：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/agent/src/agent.ts:360-388`

同一 overflow trigger 最多自动恢复一次，第二次失败会结束并发出 `compaction_end` error，避免循环：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:2001-2014`

## 5. stopReason `length` 与 compaction 的关系

### Zora 使用的 Pi 0.82.1

0.82.1 只有 `isContextOverflow()` 为 true 时才进入“压缩并重试”。普通 `length` 若 usage 尚未超过 context window，会落入 threshold check，执行 `willRetry: false` 的 compaction：

- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1508-1556`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1558-1585`

该版本压缩后的重建逻辑只再次移除 `stopReason: "error"`，没有移除 `length`：

- `/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1698-1705`

### Pi 0.84.1 / commit `32850ef7c`

新增 `isRecoverableLength(message, desiredMaxOutput)`：当 stop reason 为 `length`、原始目标输出上限大于 0、实际 output 小于目标上限时返回 true：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/ai/src/utils/overflow.ts:165-173`

该判断使用模型原始 `maxTokens`，不会使用被上下文空间临时 clamp 后的 provider request limit。满足条件后进入与 overflow 相同的“单次 compact-and-continue”路径：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:1988-2021`

底层 Agent 对含 tool call 的 `length` 响应也有保护：不会执行可能被截断的工具参数，而是为这些工具调用生成失败结果：

- `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/agent/src/agent-loop.ts:202-216`

现场中模型 `maxTokens` 高于实际 `usage.output = 1992`，因此按 0.84.1 的规则会进入可恢复 length 路径，与用户期待一致。

## 6. 对 Zora 当前修复的 review

当前补丁位于：

- `/Users/bytedance/Desktop/03-code/ZoraAgent/src/main/runtime/pi-session-bridge.ts:60-75`
- `/Users/bytedance/Desktop/03-code/ZoraAgent/src/main/runtime/pi-session-bridge.ts:275-325`

### 已覆盖的产品问题

- 识别空正文的 length response。
- 暂缓把首次 `message_end`、对应 `agent_settled` 传给产品层。
- 把恢复次数限制为一次。
- 等待 `session.prompt()` 返回，因此确实等待了 0.82.1 在 agent_end 后执行的 threshold compaction。

这些目标与 Pi 0.84.1 的恢复方向一致。

### 主要问题

1. **真实 SDK 中不会启动续跑。** `AgentSession.followUp()` 只调用 `_queueFollowUp()`，后者只入队到 `agent.followUp()`；此时 `session.prompt()` 已返回，Agent 已 idle。`waitForIdle()` 不会消费队列。源码：
   - `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:1356-1374`
   - `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/coding-agent/src/core/agent-session.ts:1393-1407`
   - `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/agent/src/agent.ts:282-310`
   - `/Users/bytedance/Desktop/03-code/github_ref/pi/packages/agent/src/agent.ts:323-329`

2. **恢复条件过窄。** 当前只恢复没有 text/toolCall 的 length。推理 token、部分正文、被截断工具调用都可能代表上下文压力。Pi 新版采用 `usage.output < model.maxTokens`，覆盖更完整，同时保留真正达到用户设定输出上限的 length。

3. **新增了伪 user turn。** bridge 的 continuation prompt 会写入 session history，改变原始任务语义与 turn 边界。Pi 原生方案移除截断 assistant 后调用 `agent.continue()`，不新增 user message。

4. **截断响应仍可能进入 compaction kept tail。** 0.82.1 的 threshold compaction不把 length 当 overflow；如果该 assistant response 位于 `firstKeptEntryId` 之后，它会保留在重建 context 中。bridge 只拦截产品事件，没有从 Pi agent state 或 session projection 中移除它。Pi 0.84.1 在 compaction 前后都显式移除可恢复 length response。

5. **产品状态与 Runtime 状态可能继续不一致。** bridge 丢弃了一个真实 `message_end` 和 `agent_settled`，但 Runtime 已经持久化该消息。后续恢复、重启、cursor 同步和产品 trace 可能看到不同的历史边界。

6. **测试替身偏离 SDK 行为。** 当前回归测试把 `followUp()` 模拟成会自行执行并产出终态，因此没有发现 idle follow-up 只入队的问题。真实语义需要由 Pi SDK 源码或真实 AgentSession 集成测试校验。

### 推荐方案

1. 升级三项 Pi 包到包含 `32850ef7c` 的同一版本，优先使用当前 0.84.1。
2. 删除 bridge 中 `EMPTY_LENGTH_CONTINUATION_PROMPT`、`isEmptyLengthAssistantMessage()`、`emptyLengthRecoveryPending/Used` 和事件吞并逻辑。
3. 保留 mapper 对最终未恢复 length 的显式错误展示，作为第二次截断或真实输出上限的终态。
4. 产品层依据 `agent_end.willRetry` 与 `compaction_end.willRetry` 保持同一个 Agent turn 为运行中，直到 SDK 发出最终 `agent_settled`。Pi 的 `session.prompt()` 已把 compaction 和内部 continue 包含在同一个 Promise 中。
5. 增加一个最小真实 `AgentSession` 集成测试，使用脚本化 stream function 依次返回 recoverable length、compaction summary、successful continuation，验证没有新增 user message、只恢复一次、最终只出现一个产品终态。

若短期不能升级，bridge 的临时修复也应复刻 0.84.1 的机制：基于原始 `model.maxTokens` 与 usage 判断，压缩前后移除截断 assistant，并通过低层 continuation 启动执行。该方案需要访问 SDK 内部状态，维护风险高于升级，建议只作为阻断性临时措施。

## 会话质量设计建议

基于 Pi 原生能力，Zora 的长期会话质量可以分为三层：

1. **Runtime transcript**：Pi JSONL 保存完整 append-only history，负责恢复、分支和审计。
2. **Provider context**：Pi 自动选择最新 structured summary、约 20k recent tail、compaction 后新增消息，再加每轮动态 system prompt 与 tools。
3. **Durable task state**：对于跨多次 compaction 的长任务，把计划、已完成结果、关键路径和待办写入工作区文件或结构化工具状态。summary 负责索引这些状态，避免把唯一事实只放在有损摘要中。

当前 Pi summary 已覆盖目标、约束、进展、决策、下一步、关键上下文和文件列表，适合通用持续会话。对需要高可靠恢复的长程任务，建议后续通过 `session_before_compact` 扩展加入 Zora 的结构化 task state，但不应在本次长度截断修复中同时引入该层。

