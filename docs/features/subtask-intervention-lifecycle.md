# 子任务用户介入与会话生命周期 Feature 方案

> 状态：v4，设计评审中
>
> 日期：2026-08-18
>
> 事故来源：2026-08-17 父会话 `06fd1696` 与子会话 `eda4e645`
>
> 关联设计：`docs/subtask-delegation.md`
>
> 参考实现：Proma `main`，`/Users/bytedance/Desktop/03-code/github_ref/Proma`

## 一、结论

子会话是用户可直接操作的完整会话。父子关系负责来源、导航和委派编排，不改变发送、编辑、停止等会话操作的语义。

本 Feature 确立以下规则：

1. 用户直接操作子会话时，发送、编辑和停止遵循普通会话规则。
2. 委派只绑定父 Agent 显式创建或继续的某一次子会话运行。
3. 子会话中的活动委派运行可以接收用户引导和修正，运行保持活动，父会话继续观察同一个 `runId`。
4. 委派结束后，用户在子会话中发送消息会启动普通 `desktop run`，不会隐式创建新的委派运行。
5. 新一轮委派只能由父 Agent 显式调用 `continue_delegation` 创建。
6. 普通发送和编辑统一进入主进程 Session Interaction 模块。renderer 不负责生命周期分支。
7. `wait_for_delegations` 的超时继续表示单次调用的固定等待窗口，权限阻塞时间沿用现有暂停规则。超时不终止子任务，父 Agent 可以继续等待。
8. 每一次 Session Run 都有稳定 `runId`。delegated run 的 Session `runId` 与 `delegationRunId` 相同。
9. delegated run 进入终态时，结果按 `{delegationId, runId}` 固化。后续普通聊天和历史编辑不能改变该结果。
10. 完整会话快照作为某个 run 的首个投影事件，renderer 先替换持久化时间线，再应用同 run 的实时事件。
11. 不新增 delegation 状态，不记录跨 run 累积的介入计数，不引入接管状态机。

本次改动包含三个实施模块：

- Session Interaction，统一普通发送、编辑和停止。
- Delegation Coordinator，负责显式委派、run 互斥、结果固化和等待。
- Session Timeline Projection，负责 snapshot 和实时事件的确定性时间线。

Delegation 观察规则和等待语义作为系统约束，不增加独立状态与持久化模块。Runtime 的 steer、follow-up、stop 和 delegated run 执行机制保持现状。

### v3 到 v4 修订

- 增加完整的 Before/After 用户旅程。
- 普通发送统一为主进程 `submitUserMessage`，删除 renderer 的 chat/queue 分流。
- 编辑增加 `EditIntent` 和 `observedRunId`，覆盖编辑期间 Run 结束或切换的竞态。
- 所有 Session Run 使用稳定 `runId`，stream event 和 snapshot 携带该标识。
- delegated run 结果按 runId 持久化，禁止后续 desktop run 污染历史委派结果。
- `continue_delegation` 与活动 desktop run 建立互斥合同。
- `session_sync` 改为 snapshot replace 加同 run event，不采用本地数组全量合并。
- 区分 Session activity 与 Delegation status 的 UI 展示。

## 二、背景与证据

### 2.1 事故 A：运行中编辑终止了委派

2026-08-17 的原始事故过程如下：

| 时间 | 事件 | 结果 |
| --- | --- | --- |
| 22:33:33 | 父会话创建子任务，子会话以 delegated run 启动 | `runId=52e96f7c` |
| 22:36:14 | 用户在子会话发送补充信息 | 消息通过 queue/steer 进入当前运行 |
| 22:36:20 | 用户再次修正上下文 | 消息通过 queue/steer 进入当前运行 |
| 22:36 至 22:38 | 用户点击运行中消息的编辑按钮 | renderer 隐式调用 stop |
| 22:38:01 | delegated run 被停止 | delegation 转为 `cancelled` |
| 22:38:10 | 用户提交修改 | 子会话以独立 `desktop run` 重新启动 |
| 22:38 至 22:44 | 子会话继续产出 | 父会话已经收到 `cancelled`，无法观察新运行 |

用户只修改了一条消息，系统却终止了当前运行，并使父会话获得与子会话实际状态不一致的结果。

直接触发点位于 `src/renderer/components/chat/MessageList.tsx`：

```typescript
if (isRunning) {
  await onStopForEdit();
}
```

### 2.2 事故 B：普通子会话输入被转换为继续委派

同一子会话的后续操作暴露了第二个问题：

1. delegation 已处于终态。
2. 用户在子会话中直接发送普通消息。
3. `agent:chat` 根据 `parentSessionId` 和 `delegationStatus` 调用 `continueDelegation`。
4. delegation attempt 从 1 增加到 2，并创建新的 `runId`。
5. delegated run 启动时发送完整 `session_sync`。
6. renderer 以当前本地消息为排序基准追加历史消息，当前消息出现在历史消息之前。

会话元数据包含 `continue_delegation:renderer:*` 调用记录，证明新的委派由普通界面输入隐式触发。

该路径还会产生两个确定性问题：

- `agent:chat` 的隐式继续分支没有传递附件，用户提交的图片或文件会丢失。
- 新运行使用 `source: "delegation"`，会重新进入父会话编排，并采用 delegated run 的记忆与工具配置。

消息顺序问题的直接原因位于 renderer 的快照合并。隐式继续委派扩大了该问题的触发范围。两层问题需要分别处理。

### 2.3 根因归纳

当前实现混合了三个生命周期：

- Session 生命周期，用户看到并持续使用的会话。
- Run 生命周期，会话中的一次 Agent 执行。
- Delegation 生命周期，父会话对某次子会话运行的编排关系。

混合后的表现包括：

- renderer 根据运行状态决定停止与编辑顺序。
- `agent:chat` 根据 delegation 元数据改变普通输入的运行来源。
- SessionMeta 同时保存会话身份和委派运行状态。
- `session_sync` 与流式事件分别修改同一个消息数组。

本方案通过明确接口和不变量收敛这些行为，并增加 run 级结果记录。SessionMeta 的现有委派字段暂时保留。

## 三、用户旅程：Before / After

用户旅程用于确定用户目标、操作顺序、界面反馈和最终结果。后续 L3 E2E 必须从这些旅程派生，不能只验证内部状态。

### 3.1 正常委派，无用户介入

| | Before | After |
| --- | --- | --- |
| 用户目标 | 让父 Agent 把独立任务交给子 Agent | 相同 |
| 用户操作 | 在父会话提出任务 | 相同 |
| 子会话 | 自动创建并运行 | 相同 |
| 父会话 | 等待子任务完成并形成总结 | 相同 |
| 用户结果 | 获得父会话的最终总结，可以打开子会话查看完整过程 | 相同 |
| 验收信号 | 现有流程可以完成 | 作为回归锚点，不引入行为变化 |

### 3.2 用户在运行中的子会话补充信息

| | Before | After |
| --- | --- | --- |
| 用户目标 | 给正在执行的子任务补充背景 | 相同 |
| 用户操作 | 打开子会话并发送消息 | 相同 |
| 输入路由 | renderer 根据本地 `isRunning` 选择 queue | 主进程 `submitUserMessage` 识别活动 Run 并 enqueue |
| Run | 通常进入当前 Run，存在状态竞态 | 同一个 `runId` 继续 |
| Delegation | 保持 `running` | 保持 `running`，attempt 不增加 |
| 界面反馈 | 显示新用户消息 | 显示消息已接收，Agent Trace 继续 |
| 父会话 | 继续等待 | 继续等待原 delegated run |
| 最终结果 | 通常能吸收补充信息 | 固化的 resultSummary 反映补充后的结果 |

### 3.3 用户修正运行中的消息

| | Before | After |
| --- | --- | --- |
| 用户目标 | 修正刚才发送的错误信息 | 相同 |
| 用户操作 | 点击修改并提交 | 点击“修正”并提交 |
| 进入编辑态 | renderer 先 stop 当前 Run | 当前 Run 保持活动 |
| 提交行为 | 修改历史并启动新的 desktop run | 追加 correction，steer 到 `observedRunId` |
| 历史 | 原消息被替换 | 原消息保留，correction 关联原消息 |
| Delegation | 进入 `cancelled` | 保持 `running` |
| 父会话 | 提前获得取消状态 | 等待同一 run 的真实终态 |
| 最终结果 | 父子会话结果可能不一致 | 父会话结果反映修正后的产出 |

### 3.4 用户编辑期间原 Run 已经完成

| | Before | After |
| --- | --- | --- |
| 用户操作 | 运行中打开编辑器，稍后提交 | 相同 |
| 状态变化 | 提交前原 Run 已完成 | 主进程通过 `observedRunId` 识别原 Run 已终态 |
| 提交行为 | 按空闲编辑改写历史，可能截断刚完成的输出 | 保留已有历史，追加 correction，启动新的 desktop run |
| Delegation | 历史结果可能被后续会话内容覆盖 | 原 delegated run 结果保持固化 |
| 用户反馈 | 刚完成的回复可能消失 | 原回复和新的修正处理都可见 |

### 3.5 委派完成后继续在子会话聊天

| | Before | After |
| --- | --- | --- |
| 用户目标 | 把子会话作为普通会话继续使用 | 相同 |
| 用户操作 | 直接发送普通消息 | 相同 |
| Run | renderer 输入被转换为 `continue_delegation` | 启动新的 desktop run |
| 附件 | 隐式 continue 分支没有传递附件 | 文本和附件按普通会话路径保存并发送 |
| Delegation | attempt 增加，父会话重新关联 | 历史 status、runId、attempt 保持不变 |
| Memory | 使用 delegated run 规则 | 使用 desktop run 规则 |
| 父会话 | 可能重新观察该会话 | 不观察独立 desktop run |
| 用户结果 | 普通聊天和委派语义混合 | 与普通会话一致 |

### 3.6 普通聊天后父会话再次读取委派结果

| | Before | After |
| --- | --- | --- |
| 前置状态 | delegated run A 已完成，desktop run B 也已完成 | 相同 |
| 父会话操作 | 调用 `get_delegation_results` | 相同 |
| 结果来源 | 读取子 Session 最后一条 assistant，可能得到 B | 按 `{delegationId, runId}` 读取固化的 A 结果 |
| 应用重启 | live result 丢失后更容易读取错误内容 | 结果记录持久化，重启后保持一致 |
| 用户结果 | 父会话可能引用独立聊天内容 | 父会话始终获得对应 delegated run 的结果 |

### 3.7 父 Agent 显式继续已结束的委派

| | Before | After |
| --- | --- | --- |
| 子 Session 空闲 | 可以创建新 delegated run | 相同，生成新 `runId` 并增加 attempt |
| 子 Session 有 desktop run | 先更新 delegation 元数据，随后可能启动失败 | 返回 `child_session_busy`，元数据保持不变 |
| 原结果 | 通过 Session 最后一条 assistant 推导 | 原 run 结果保持固化 |
| 新结果 | 完成后覆盖当前委派状态 | 按新 runId 固化并成为当前委派结果 |

### 3.8 用户停止子会话

| 场景 | Before | After |
| --- | --- | --- |
| delegated run 运行中 | stop 当前 Run，delegation 转为 `cancelled` | 保持该语义 |
| desktop run 运行中 | stop 当前 Run | 历史 delegation 终态和结果不变化 |
| 父会话等待中 | delegated run 取消后 wait 返回 | 相同 |
| 父会话已停止 | 子 delegated run 默认继续 | 相同，不级联停止 |

### 3.9 父会话等待超时

| | Before | After |
| --- | --- | --- |
| 子任务 | 仍为 `running` | 仍为 `running` |
| wait | 返回 `timeout` | 相同 |
| 父会话表达 | 可能把 timeout 描述成任务失败 | 工具合同明确 timeout 只结束当前等待 |
| 后续 | 由父 Agent 自行判断 | 需要结果时继续调用 `wait_for_delegations` |
| 用户结果 | 可能得到提前总结 | 父会话不能声称任务已完成、失败或取消 |

### 3.10 子任务请求权限或用户回答

| | Before | After |
| --- | --- | --- |
| 请求显示 | 父会话和子会话共享请求 | 相同 |
| 用户处理 | 任一入口批准、拒绝或回答 | 相同 |
| wait | permission 阻塞期间暂停 deadline，问题返回 `needs_input` | 相同 |
| 解除后 | 子任务继续 | 相同 |
| 验收信号 | 现有机制可以工作 | 作为双入口回归锚点 |

### 3.11 打开或恢复正在运行的子会话

| | Before | After |
| --- | --- | --- |
| 用户操作 | 打开已有历史和当前运行的子会话 | 相同 |
| 快照处理 | snapshot 与本地数组合并，历史可能出现在当前消息后面 | 先替换该 run 的持久化时间线，再应用实时事件 |
| 事件身份 | stream event 没有统一 run 标识 | snapshot 和 stream event 携带 `runId` |
| 迟到事件 | 可能写入新的 Run | 与当前 `runId` 不匹配时忽略 |
| 用户结果 | 消息顺序、重复和流式状态可能异常 | 历史、当前消息和 Agent Trace 顺序稳定 |

### 3.12 子会话状态在侧边栏中的表达

| | Before | After |
| --- | --- | --- |
| 前置状态 | 历史 delegation 已完成，当前 desktop run 正在执行 | 相同 |
| 状态来源 | 侧边栏主要读取 `delegationStatus` | 主状态读取 Session activity，委派状态作为历史信息 |
| 父会话聚合 | 读取 delegationStatus | 保持不变，desktop run 不改变子任务完成数量 |
| 用户结果 | 侧边栏可能显示已完成，但正文仍在运行 | 当前运行状态和历史委派状态同时可理解 |

## 四、领域模型

### 4.1 Session

Session 是用户可见、可持续操作的会话，负责：

- 消息历史和附件。
- 会话标题、归档和父子层级。
- 当前 Runtime checkpoint。
- 用户直接发送、编辑和停止的入口。

子会话与普通会话共享 Session 语义。`parentSessionId` 表达来源和界面层级。

### 4.2 Run

Run 是 Session 中的一次执行，负责：

- 当前是否运行。
- 流式输出。
- steer 与 follow-up。
- 权限请求和用户提问。
- 停止与最终结果。

一个 Session 在不同时刻可以产生多个 Run。任一时刻最多存在一个活动 Run。

每一个 Run 都有稳定 `runId`，不区分 desktop、delegation、Feishu 或 schedule 来源。`AgentRunInfo`、`agent_status`、`session_sync` 和后续 stream event 都携带该标识。

delegated run 使用 coordinator 创建的 `delegationRunId` 作为 Session `runId`。该约束让 Session Interaction、Delegation Coordinator 和 Timeline Projection 可以校验同一次执行。

### 4.3 Delegation

Delegation 是父会话对某次子会话 Run 的编排关系，负责：

- 父会话创建或显式继续子任务。
- 父会话等待指定 delegated run。
- 父会话停止指定 delegated run。
- delegated run 的状态和结果摘要。

Delegation 的运行级身份为：

```text
{ delegationId, runId }
```

`delegationId` 当前复用子 Session ID。`runId` 标识具体 attempt。所有停止、继续和迟到事件都必须校验 `runId`。

delegated run 进入终态时生成持久化结果记录：

```typescript
interface DelegationResultRecord {
  delegationId: string;
  runId: string;
  status: SubtaskStatus;
  resultSummary?: string;
  resultTruncated: boolean;
  error?: string;
  completedAt: number;
}
```

结果记录由 Delegation Coordinator 写入独立的持久化存储。它不随 Session 历史修改、desktop run 或应用重启变化。`get_delegation_results` 只读取当前 `delegationRunId` 对应的结果记录。

### 4.4 三者关系

```text
Parent Session
  └─ Delegation { delegationId, runId }
       ├─ Child Session 中的一次 delegated Run
       └─ DelegationResultRecord { delegationId, runId }

Child Session
  ├─ delegated Run A
  ├─ desktop Run B
  └─ delegated Run C，由父 Agent 显式 continue 创建
```

父子层级可以长期存在。Delegation 只覆盖具体 delegated run。用户在同一子 Session 中启动的独立 desktop run 不恢复历史 Delegation。

## 五、系统不变量

以下不变量同时约束实现和测试：

1. Session 是用户操作的一级对象。
2. 用户对子会话的发送、编辑和停止与普通会话具有相同语义。
3. `parentSessionId` 不参与普通输入的运行来源判断。
4. renderer 只提交用户意图，不根据本地运行状态选择 chat、queue 或 revise 路径。
5. 用户界面输入不会隐式调用 `continue_delegation`。
6. 父 Agent 显式调用 `continue_delegation` 才会创建新的 delegated run。
7. 每一个 Session Run 都有稳定 `runId`，所有状态和流式事件携带该标识。
8. 用户在活动 Run 中发送消息时，消息进入该 Run 的 queue/steer 链路。
9. 用户在空闲 Session 中发送消息时，系统启动 `source: "desktop"` 的 Run。
10. 同一 Session 任一时刻最多存在一个活动 Run。
11. 用户显式停止只停止当前活动 Run。
12. 停止 delegated run 会把对应 Delegation 标记为 `cancelled`。
13. 停止子 Session 中的独立 desktop run 不修改历史 Delegation 终态和结果。
14. 运行中编辑产生一条 correction 消息，原消息保留。
15. 空闲时发起的历史编辑可以改写历史，并从修改后的消息启动新的 desktop run。
16. correction 提交携带 `observedRunId`；原 Run 已结束时保留历史并启动新的 desktop run 处理修正。
17. 编辑提交只能产生一种完整结果，不得留下未被任何 Run 接收的 correction。
18. Delegation 状态只描述 delegated run 的结果，不描述用户参与程度。
19. delegated run 的结果按 `{delegationId, runId}` 持久化，后续 Session 内容不能改变该结果。
20. `continue_delegation` 只能在子 Session 空闲时提交；冲突返回 `child_session_busy`，委派元数据不变化。
21. `wait_for_delegations` 超时只结束当前等待调用，不停止 Run，不修改 Delegation 状态。
22. `session_sync` 是对应 run 的首个投影事件，并包含已持久化消息的权威顺序。
23. renderer 应用 snapshot 后，只接受同一 `runId` 的后续实时事件。
24. 与当前 runId 不匹配的迟到事件不能改变时间线。
25. Session activity 与 Delegation status 分开显示和聚合。
26. 同一条消息只能在投影结果中出现一次。
27. 子任务仍保持单层委派，不注册 subtask 工具。

## 六、用户行为矩阵

| Session 状态 | 用户或父 Agent 操作 | Session Run 行为 | Delegation 行为 | UI 或调用结果 |
| --- | --- | --- | --- | --- |
| 普通 Session 空闲 | 用户发送消息 | `submitUserMessage` 启动 desktop run | 无 | 正常开始回复 |
| 普通 Session 运行中 | 用户发送消息 | `submitUserMessage` enqueue 到当前 `runId` | 无 | 显示消息已接收，当前回复继续 |
| 子 Session 空闲，历史 delegation 已结束 | 用户发送消息 | 启动 desktop run | 历史终态和固化结果不变 | 与普通 Session 相同 |
| 子 Session 的 delegated run 运行中 | 用户发送消息 | enqueue 到当前 delegated run | 同一 `runId` 继续，attempt 不变 | 父会话仍等待原任务 |
| 任意 Session 运行中 | 用户打开编辑并立即提交 | correction steer 到 `observedRunId` | delegated run 保持 `running` | 原消息保留，显示 correction |
| 用户编辑期间原 Run 已结束 | 用户提交运行中修正意图 | 保留历史，追加 correction，启动 desktop run | 已结束 Delegation 和固化结果不变 | 已完成回复保留，新 Run 处理修正 |
| 任意 Session 空闲 | 用户发起历史编辑并提交 | 改写历史并启动 desktop run | 历史 Delegation 不变 | 从修改位置重新生成 |
| 历史编辑提交前另一个 Run 已开始 | 用户提交历史编辑意图 | 不修改历史，返回 `state_changed` | 不变 | 保留编辑内容并提示状态已变化 |
| delegated run 运行中 | 用户停止 | 停止匹配 `expectedRunId` 的 Run | 对应 Delegation 进入 `cancelled` | 父会话获得取消状态 |
| 子 Session 的 desktop run 运行中 | 用户停止 | 停止匹配 `expectedRunId` 的 Run | 历史 Delegation 不变 | 当前普通回复停止 |
| delegation 已结束，子 Session 空闲 | 父 Agent 显式继续 | 启动新的 delegated run | attempt 增加，创建新 `runId` | 子会话保留历史并继续任务 |
| delegation 已结束，子 Session 有活动 desktop run | 父 Agent 显式继续 | 不启动新 Run | 返回 `child_session_busy`，元数据不变 | 父 Agent 稍后重试或等待用户 Run 完成 |
| delegated run A 已结束，desktop run B 已结束 | 父 Agent 读取 A 的结果 | 不启动 Run | 读取 `{delegationId, runId=A}` 的固化结果 | 不返回 B 的 assistant 内容 |
| 父会话运行被停止 | 子 delegated run 仍活动 | 子 Run 继续 | Delegation 继续更新 | 后续可查询结果 |
| 打开或恢复活动 Session | 接收 `session_sync` | 替换持久化时间线，再应用同 run 事件 | 不变 | 顺序稳定，无重复消息 |

## 七、目标与范围

### 7.1 目标

- 消除运行中编辑导致的隐式停止。
- 消除普通子会话输入导致的隐式继续委派。
- 将普通发送收敛到单一主进程接口，移除 renderer 的运行状态分流。
- 保证普通输入中的附件进入正确 Run。
- 保证编辑提交依据主进程中的真实运行状态、编辑意图和 `observedRunId` 处理。
- 保证父会话持续观察用户修正后的同一个 delegated run。
- 保证 delegated run 的结果在后续普通聊天和应用重启后保持一致。
- 保证父 Agent 显式继续与用户 desktop run 互斥，冲突时不提前修改委派元数据。
- 保证 `session_sync` 与实时事件按统一 `runId` 投影，消息顺序稳定。
- 区分当前 Session activity 与历史 Delegation status。
- 用 L1、L2 和真实 Provider E2E 固化行为。

### 7.2 不在本期范围

- 不新增 `taken_over`、`user_aborted`、`user_takeover` 等状态。
- 不记录 `delegationUserInterventions` 或 `delegationLastInterventionAt`。
- 不因用户介入重置 `wait_for_delegations` 的 deadline。
- 不增加编辑确认弹窗。
- 不在停止后自动恢复历史 Delegation。
- 不引入硬 interrupt。本期继续使用现有 steer 与 `beforeToolCall` 机制。
- 不把完整 Delegation 模型迁出 SessionMeta。本期只增加 run 级结果存储。
- 不允许子任务继续创建子任务。
- 不在本 Feature 中实现父 Agent 主动发送指导消息的工具。
- 不为缺少结果记录的旧 delegated run 推导结果或增加迁移逻辑。

### 7.3 独立 Feature

父 Agent 当前缺少向活动子任务发送指导消息的工具。后续可以增加：

```text
message_delegation({ delegationId, expectedRunId, message })
```

该工具复用 queue/steer 链路，并严格校验 `expectedRunId`。它属于新的父 Agent 编排能力，不影响本 Feature 的用户会话语义。

## 八、架构设计

三个模块形成由浅到深的调用方向：

| Module | Interface | 隐藏的实现细节 | Adapter |
| --- | --- | --- | --- |
| Session Interaction | `submitUserMessage`、`submitUserEdit`、`stopCurrentRun` | Session 命令串行化、活动 Run 判断、消息与附件提交、queue/steer、Run 启动 | IPC handler、消息仓库、AgentExecutionService |
| Delegation Coordinator | `start`、`continue`、`wait`、`stop`、`getResults` | delegated run 身份、Session 互斥、终态提交、结果固化、父会话通知 | SessionMeta、DelegationResultStore、Session Interaction |
| Session Timeline Projection | `beginProjection`、`applyRunEvent`、`endProjection` | snapshot barrier、活动 Run 事件缓冲、顺序、去重、迟到事件过滤 | 主进程事件发布器、renderer store |

renderer 只依赖 Session Interaction 和 Session Timeline Projection 的接口。父 Agent 工具只依赖 Delegation Coordinator。三个模块之间通过 `sessionId`、`runId`、稳定 `messageId` 和终态结果合同连接，避免调用方读取对方的内部状态。

### 8.1 模块一：Session Interaction

Session Interaction 是用户直接操作 Session 的唯一主进程模块。它隐藏活动 Run 查询、session 级串行化、消息持久化、附件保存、queue/steer、启动 Run 和停止校验。

对 renderer 暴露三个接口：

```typescript
type SubmitUserMessageInput = {
  sessionId: string;
  workspaceId: string;
  messageId: string;
  text: string;
  attachments: AttachmentInput[];
};

type SubmitUserMessageResult =
  | {
      mode: "started";
      runId: string;
      source: "desktop";
    }
  | {
      mode: "enqueued";
      runId: string;
      source: AgentRunSource;
    };

type StopCurrentRunInput = {
  sessionId: string;
  expectedRunId: string;
};

type StopCurrentRunResult =
  | { mode: "stopped"; runId: string }
  | { mode: "not_running" }
  | { mode: "state_changed"; activeRunId: string };

interface SessionInteraction {
  submitUserMessage(input: SubmitUserMessageInput): Promise<SubmitUserMessageResult>;
  submitUserEdit(input: SubmitUserEditInput): Promise<SubmitUserEditResult>;
  stopCurrentRun(input: StopCurrentRunInput): Promise<StopCurrentRunResult>;
}
```

`submitUserMessage` 在同一个 session 级串行操作中执行：

```text
读取活动 Run
  ├─ 存在活动 Run
  │    ├─ 保存附件并持久化用户消息
  │    ├─ enqueue 到该 runId
  │    └─ 返回 enqueued
  └─ Session 空闲
       ├─ 保存附件并持久化用户消息
       ├─ 创建 desktop runId
       ├─ 启动 source=desktop 的 Run
       └─ 返回 started
```

这里需要一个短时 Session Command Gate。它只覆盖状态判断和命令提交，不等待 Runtime 完成：

```text
Session Command Gate
  ├─ 读取或注册 ActiveRun { runId, source, phase }
  ├─ 提交消息、enqueue、stop 或终态转换
  └─ 返回提交结果

Runtime completion
  -> 在 Gate 外等待
  -> 完成后重新进入 Gate
  -> 校验 runId 并提交终态
```

现有 `runSessionOperation` 会持有队列直到整个 Runtime 执行结束，不能直接作为该 Gate。实现阶段需要缩短其临界区，或增加独立的 Session Command Gate。否则活动 Run 中的追加消息、correction、stop 和 continue 冲突检查会被阻塞到 Run 结束。

AgentExecutionService 的内部 Interface 同步增加 run 级校验：

```typescript
interface AgentExecution {
  start(input: StartRunInput & { runId: string }): ActiveRunHandle;
  enqueue(sessionId: string, expectedRunId: string, message: QueuedMessage): Promise<void>;
  stop(sessionId: string, expectedRunId: string): Promise<StopCurrentRunResult>;
  getRunInfo(sessionId: string): AgentRunInfo;
}

interface ActiveRunHandle {
  runId: string;
  completion: Promise<AgentRuntimeResult>;
}
```

`start` 在 Gate 释放前注册 ActiveRun，并立即返回 handle。Runtime completion 在后台继续。该顺序消除两个发送请求同时观察到空闲并启动两个 Run 的窗口。

新 Run 的启动协议固定为：

```text
校验 Session 和 Runtime 配置
  -> 注册 ActiveRun { runId, phase=starting }
  -> 持久化首条用户消息和附件
  -> beginProjection，发送 session_sync
  -> 启动 Runtime，phase=running
  -> Gate 释放
```

`starting` 阶段收到的追加消息先进入 AgentExecutionService 的 run 级队列，Runtime handle 创建后按序发送。任何 Runtime 事件都只能在 `session_sync` 之后发布。

接口规则：

- renderer 不再选择 `agent:chat` 或 `agent:queue-message`。
- `parentSessionId` 和历史 delegation 字段不参与普通输入路由。
- 活动 delegated run 与活动 desktop run 使用相同的 enqueue 行为。
- 文本、附件和 `messageId` 在两条内部路径中使用同一个输入合同。
- 消息持久化与 Run 接收必须形成完整结果。enqueue 失败时不能留下已显示为已接收、但未进入任何 Run 的消息。
- `continue_delegation` 只通过父 Agent 委派工具进入 Delegation Coordinator。
- `stopCurrentRun` 校验 `expectedRunId`。Run 已切换时返回 `state_changed`，不能停止新 Run。
- `submitUserMessage` 和 `submitUserEdit` 在命令提交后立即返回，不等待 assistant 最终回复。

该模块形成稳定接口，renderer、普通 Session 和子 Session 复用同一行为。内部的 IPC handler、消息仓库和 AgentExecutionService 属于 Adapter，可以独立替换。

### 8.2 编辑意图与提交竞态

`MessageList.startEditing` 只记录用户的编辑意图和观察到的 Run，不调用 stop。提交统一调用 `SessionInteraction.submitUserEdit`：

```typescript
type EditIntent = "correct_active_run" | "revise_history";

type SubmitUserEditInput = {
  sessionId: string;
  workspaceId: string;
  targetMessageId: string;
  text: string;
  intent: EditIntent;
  observedRunId?: string;
};

type SubmitUserEditResult =
  | {
      mode: "steered";
      runId: string;
      correctionMessageId: string;
    }
  | {
      mode: "started_correction";
      runId: string;
      correctionMessageId: string;
    }
  | {
      mode: "revised";
      runId: string;
      session: SessionMeta;
    }
  | {
      mode: "state_changed";
      activeRunId?: string;
    };
```

`intent` 由用户进入编辑态时的操作含义决定。主进程使用 `observedRunId` 与提交时的真实状态解决竞态：

| 编辑意图 | 提交时状态 | 结果 | 历史处理 |
| --- | --- | --- | --- |
| `correct_active_run` | `observedRunId` 仍为活动 Run | `steered` | 保留原消息，追加 correction 并 enqueue 到同一 Run |
| `correct_active_run` | `observedRunId` 已结束，Session 空闲 | `started_correction` | 保留原消息和已完成输出，追加 correction 并启动 desktop run |
| `correct_active_run` | 已有另一个活动 Run | `state_changed` | 不修改历史，不停止新 Run |
| `revise_history` | Session 空闲 | `revised` | 改写目标消息，截断派生历史，启动 desktop run |
| `revise_history` | 已有活动 Run | `state_changed` | 不修改历史，不停止活动 Run |

主进程必须在同一个 session 级串行操作中完成状态判断、持久化和 Run 提交。允许返回的完整结果为：

- correction 已持久化，并被匹配的活动 Run 接收。
- 原 Run 已结束，已完成历史保留，correction 已持久化，并启动新的 desktop run。
- 历史已按用户明确的 `revise_history` 意图改写，并启动新的 desktop run。
- 状态发生变化，持久化历史保持不变。

禁止产生以下状态：

- correction 已写入 JSONL，enqueue 时才发现目标 Run 已结束。
- 已完成的 assistant 输出被运行中修正意图截断。
- 历史已经重写，同时活动 Run 仍在输出。
- renderer 先停止 Run，再提交编辑。

correction 格式：

```text
[用户修正了此前的消息]
原消息：{oldText}
修正为：{newText}
请基于修正后的内容继续当前任务。
```

规则：

- 原消息保持不变。
- correction 使用新的 user message ID。
- correction 记录目标 `messageId`，便于 UI 建立关联。
- 当前正在执行的工具不强制终止。
- `beforeToolCall` 在下一次工具调用前让 Runtime 吸收 steer 消息。
- 第一版只修改文本。目标消息已有附件时，附件继续保留在原消息中，不复制到 correction。

UI 展示：

- 运行中操作显示为“修正”。
- 空闲状态显示为“编辑并重新运行”。
- 运行中提交后，原消息保持原文。
- 新 correction 作为独立用户消息展示，并标记其目标消息。
- renderer 不对原消息执行乐观文本替换。
- `state_changed` 时保留编辑器文本，提示用户当前会话状态已经变化。

### 8.3 模块二：Delegation Coordinator

Delegation Coordinator 只处理父 Agent 的委派操作。它通过 Session Interaction 和 AgentExecutionService 的内部接口启动、继续、等待和停止 delegated run，并拥有委派结果的写入权限。

创建或显式继续 delegated run 时：

- 在 session 级串行操作中确认子 Session 空闲。
- 子 Session 有任意活动 Run 时返回 `child_session_busy`。
- 冲突返回前后，`delegationStatus`、`delegationAttempt`、`delegationRunId` 和 `delegationRevision` 保持不变。
- 空闲时创建新的 `runId`，将其同时作为 Session Run ID 和 `delegationRunId`。
- 委派元数据更新与 Run 启动必须形成完整提交。Run 未启动时不能暴露新的 `running` 状态。

活动 delegated run 接收用户消息或 correction 后：

- `delegationStatus` 保持 `running`。
- `delegationRunId` 保持不变。
- `delegationAttempt` 保持不变。
- coordinator 的 completion Promise 继续等待当前 Run。
- Run 自然结束后，coordinator 按现有映射得到 `completed`、`failed` 或 `cancelled`。

Run 进入终态时，提交顺序为：

```text
确认终态事件的 runId 等于当前 delegationRunId
  -> 从该 Run 的终态结果生成 resultSummary
  -> 写入 DelegationResultRecord { delegationId, runId }
  -> 更新 SessionMeta 中的 delegation 终态
  -> 解除 wait 并通知父会话
```

`wait_for_delegations`、`list_delegations` 和 `get_delegation_results` 只读取 `delegationRunId` 对应的 `DelegationResultRecord`。禁止扫描子 Session 的最后一条 assistant 消息来推导历史委派结果。终态 Delegation 缺少结果记录时返回明确的 `result_unavailable`。

结果存储是 Delegation Coordinator 的内部实现细节。调用方只依赖创建、继续、等待、停止和读取结果接口。

用户介入不需要新的 delegation 事件和持久化字段。父会话观察 Run 的真实状态和最终结果即可。

### 8.4 等待语义

`wait_for_delegations.timeoutSeconds` 保持固定等待窗口：

```text
deadline = wait 调用时间 + timeoutSeconds
```

用户引导和 correction 不重置 deadline。原因如下：

- timeout 限制父 Agent 单次调用的有效等待时间，不定义子任务最长运行时间。
- timeout 返回时，delegation 仍为 `running`，子 Run 继续执行。
- 父 Agent 可以根据最新 summary 再次调用 wait。
- 固定 deadline 不会因并行子任务中的单个介入无限延长。
- 不需要在 SessionMeta 中维护跨 attempt 的介入计数。

wait 工具说明增加以下规则：

> timeout 只结束本次等待。目标仍为 running 时，不得把 timeout 描述为任务失败或取消；需要结果时继续调用 wait_for_delegations。

权限阻塞继续沿用现有处理：

- permission 阻塞期间暂停 deadline。
- AskUserQuestion 返回 `needs_input`。
- 用户在父会话或子会话解除阻塞后，父 Agent 可以继续等待。

### 8.5 模块三：Session Timeline Projection

Session Timeline Projection 将持久化消息快照与实时 Run 事件投影为 renderer 时间线。它不读取 Delegation 状态，也不推断用户操作语义。模块包含主进程 publisher 和 renderer projection 两部分，对外保持一个投影合同。

最小接口为：

```typescript
type SessionSyncEvent = {
  type: "session_sync";
  sessionId: string;
  runId: string;
  messages: ConversationMessage[];
};

interface SessionTimelineProjection {
  beginProjection(event: SessionSyncEvent): void;
  applyRunEvent(event: RunScopedAgentStreamEvent): void;
  endProjection(sessionId: string, runId: string): void;
}
```

投影合同：

1. 每个 renderer 投影周期从 `session_sync` 开始。新 Run 启动、窗口重连和活动 Session 恢复都会创建新的投影周期。
2. snapshot 包含发出前已经持久化的完整时间线，并决定这些消息的权威顺序。
3. 主进程创建 snapshot 期间缓冲该 Session 的实时事件，发送 snapshot 后按原顺序释放缓冲。
4. renderer 收到 snapshot 后替换该 Session 的持久化时间线，清理上一投影周期遗留的 streaming block。
5. snapshot 之后只应用 `runId` 相同的实时事件。
6. 与当前 `runId` 不匹配的迟到事件直接忽略。
7. 同一 run 内按主进程转发顺序应用事件。
8. 活动 Run 恢复时，主进程在 snapshot 后重放该 Run 尚未持久化的投影事件，再切换到实时转发。
9. 用户提交中的本地 pending message 使用稳定 `messageId`。主进程接受同一 ID 后转为持久化消息，不进行本地消息全量拼接。
10. 同一个 `messageId` 在投影结果中只出现一次。
11. 重复应用相同 snapshot 和同一组事件产生相同结果。

主进程只为当前活动 Run 保留投影事件缓冲，Run 终态且消息持久化后释放。该缓冲用于 renderer 重连，不新增持久化事件日志。应用整体重启后没有活动 Run，直接从消息仓库恢复终态历史。

该合同删除 `mergeConversationMessages(currentMessages, snapshotMessages)` 一类双数组全量合并。消息历史、streaming assistant 和 Agent Trace 通过明确的 snapshot 与 event 阶段进入时间线。

## 九、关键链路

### 9.1 活动 Run 中发送消息

```text
ChatInput
  -> submitUserMessage
  -> session 级串行操作
  -> 识别活动 runId
  -> 保存附件并持久化用户消息
  -> AgentExecutionService.enqueue(runId)
  -> 返回 enqueued
```

普通 Session 和子 Session 复用该链路。

### 9.2 空闲 Session 中发送消息

```text
ChatInput
  -> submitUserMessage
  -> session 级串行操作
  -> 确认 Session 空闲
  -> 保存附件并持久化用户消息
  -> 创建 runId
  -> runPromptInSession(source: "desktop")
  -> 返回 started
```

该链路不读取 `parentSessionId` 或历史 `delegationStatus`。renderer 不需要知道 Session 在提交瞬间是否运行。

### 9.3 运行中修正

```text
MessageList
  -> submitUserEdit(intent=correct_active_run, observedRunId)
  -> 主进程确认 observedRunId 仍活动
  -> append correction
  -> enqueue 到 observedRunId
  -> 返回 steered
```

若 `observedRunId` 已结束且 Session 空闲，主进程保留原 Run 的完整历史，追加 correction，并启动 desktop run。若另一个 Run 已开始，返回 `state_changed`。

### 9.4 空闲时编辑

```text
MessageList
  -> submitUserEdit(intent=revise_history)
  -> 主进程确认 Session 空闲
  -> reviseUserMessageRecord
  -> 清理派生 Runtime 上下文
  -> runPromptInSession(source: "desktop")
```

### 9.5 父 Agent 显式继续委派

```text
continue_delegation
  -> 校验 expectedRunId
  -> session 级串行操作
  -> 确认子 Session 空闲
  -> 增加 attempt
  -> 创建新 runId
  -> runPromptInSession(source: "delegation")
```

子 Session 有任意活动 Run 时返回 `child_session_busy`，委派元数据不变化。该链路不由 renderer 普通输入调用。

### 9.6 delegated run 结果固化与读取

```text
delegated run 终态
  -> 校验 runId
  -> 生成该 Run 的 resultSummary
  -> persist DelegationResultRecord
  -> 更新 delegation 终态
  -> resolve wait

get_delegation_results
  -> 读取 SessionMeta.delegationRunId
  -> lookup DelegationResultRecord(delegationId, runId)
  -> 返回固化结果
```

后续 desktop run、历史编辑和应用重启不改变已固化结果。

### 9.7 snapshot 与实时事件

```text
Run 启动
  -> session_sync(sessionId, runId, persistedMessages)
  -> renderer replace timeline
  -> stream events(sessionId, runId)
  -> renderer apply same-run events
  -> terminal event(sessionId, runId)
  -> clear active projection state
```

旧 Run 的迟到事件在 `runId` 校验阶段被忽略。

## 十、状态与数据

### 10.1 SubtaskStatus

保持现有枚举：

```typescript
type SubtaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
```

| 状态 | 含义 |
| --- | --- |
| `running` | 对应 delegated run 仍在执行 |
| `completed` | 对应 delegated run 正常完成 |
| `failed` | 对应 delegated run 执行失败 |
| `cancelled` | 对应 delegated run 被显式停止或 Runtime 返回 stopped |
| `interrupted` | 应用退出等系统中断导致运行无法继续 |

### 10.2 SessionMeta

现有 delegation 字段暂时保留在 SessionMeta，由 coordinator 集中读写：

renderer 和普通聊天 IPC 不根据以下字段决定普通输入的运行来源：

- `delegationStatus`
- `delegationRunId`
- `delegationAttempt`
- `delegationRevision`

本 Feature 不实施完整 `DelegationRecord` 迁移。run 级结果使用独立记录，避免 Session 后续内容改变已完成委派的结果。

### 10.3 Run 身份

所有来源的 Session Run 使用同一身份合同：

```typescript
type AgentRunSource =
  | "desktop"
  | "delegation"
  | "feishu"
  | "schedule"
  | "memory";

interface AgentRunInfo {
  running: boolean;
  runId?: string;
  source?: AgentRunSource;
}

interface RunScopedEvent {
  sessionId: string;
  runId: string;
}
```

规则：

- Run 创建时生成一次 `runId`，直到终态保持不变。
- delegated run 直接使用 coordinator 创建的 `delegationRunId`。
- `agent_status`、`session_sync`、assistant delta、thinking、工具调用、权限状态和终态事件均携带 `runId`。
- enqueue、stop、correction 和 Delegation 操作使用 `runId` 进行并发校验。
- renderer 不接受缺少 `runId` 的活动 Run 事件。

### 10.4 Correction 消息

扩展 `ConversationMessage`：

```typescript
interface ConversationMessage {
  correction?: {
    targetMessageId: string;
  };
}
```

`correction` 存在时，该用户消息是对 `targetMessageId` 的修正。该字段用于 UI 展示关联，不参与 Runtime prompt 选择。Runtime 接收格式化后的 correction 文本。

### 10.5 DelegationResultRecord

```typescript
interface DelegationResultRecord {
  delegationId: string;
  runId: string;
  status: SubtaskStatus;
  resultSummary?: string;
  resultTruncated: boolean;
  error?: string;
  completedAt: number;
}
```

父 Agent 工具使用明确的可用性字段：

```typescript
interface DelegationResultItem {
  delegationId: string;
  runId: string;
  status: SubtaskStatus;
  availability: "pending" | "available" | "unavailable";
  resultSummary?: string;
  error?: string;
  errorCode?: "result_unavailable";
  truncated: boolean;
}
```

`running` 对应 `pending`。终态且存在结果记录时为 `available`。终态但结果记录缺失时为 `unavailable`，同时返回 `errorCode: "result_unavailable"`。

存储规则：

- 唯一键为 `{delegationId, runId}`。
- 只允许从 `running` 写入一次终态结果。同一终态事件的重复提交必须幂等。
- 结果记录写入成功后，coordinator 才发布可观察的委派终态并解除 wait。
- coordinator 使用 `AgentRuntimeResult.finalText` 或对应 Run 的终态输出生成摘要，不扫描整个 Session。
- `SessionMeta.delegationRunId` 指向当前 attempt 的结果记录。
- wait、list 和 get results 的结果字段不读取 Session 最后一条 assistant 消息。
- 删除 Session 时级联删除该 Session 的委派结果记录。
- 旧 delegated run 缺少结果记录时返回 `result_unavailable`。本 Feature 不增加推导逻辑或迁移脚本。
- 应用在结果记录写入后、SessionMeta 终态更新前退出时，启动恢复流程根据同一 `runId` 的结果记录补齐 SessionMeta。该恢复只处理本 Feature 写入的未完成终态提交。

物理存储使用每个 run 一份的原子 JSON sidecar：

```text
~/.zora/workspaces/{workspaceId}/delegation-results/{delegationId}/{runId}.json
```

写入复用现有 `replaceFileAtomically`。同一 key 重复写入相同终态时直接成功，内容不一致时返回冲突错误。该结构不修改 Session JSONL，不随历史重写变化，也不需要新增数据库依赖。归档 Session 保留结果目录；永久删除 Session 或 Workspace 时同步删除对应目录。

`resultSummary` 继续使用现有 50,000 字符上限和截断说明。对上层只暴露 `putTerminalResult`、`getResult` 和 `deleteBySession` 三个操作。

### 10.6 UI 状态

UI 同时消费两类状态：

| 状态 | 数据来源 | 用途 |
| --- | --- | --- |
| Session activity | `AgentRunInfo.running`、`runId`、`source` | 输入框、停止按钮、当前运行标识、侧边栏主状态 |
| Delegation status | SessionMeta delegation 字段与结果记录 | 父会话聚合、子任务历史状态、结果读取 |

当历史 Delegation 已完成且当前 desktop run 正在执行时，侧边栏主状态显示当前运行，委派完成状态作为次级历史信息。父会话的子任务完成数量继续只读取 Delegation status。

## 十一、当前进度与分阶段实施

### 11.1 当前进度

| 项目 | 状态 | 结果 |
| --- | --- | --- |
| 事故证据与根因定位 | 已完成 | 已确认编辑隐式 stop、普通输入隐式 continue、附件丢失和消息顺序问题 |
| 关联代码审视 | 已完成 | 已确认结果读取会被后续 desktop run 污染，显式 continue 缺少 Session Run 互斥 |
| Before/After 用户旅程 | 已完成 | 覆盖普通发送、修正竞态、停止、等待、权限、恢复和父会话结果读取 |
| 领域模型与不变量 | 已完成 | Session、Run、Delegation 和结果记录边界已经明确 |
| 模块接口设计 | 已完成 | Session Interaction、Delegation Coordinator、Session Timeline Projection 已定义 |
| Feature 专用代码 | 未开始 | 先前的局部消息合并修改已经清除，当前实现进度为 0 |
| L1、L2、L3 测试 | 未开始 | 用例已在本方案定义，需随实现同步完成 |
| 关联设计文档同步 | 未开始 | `docs/subtask-delegation.md` 仍描述从最后一条 assistant 推导结果，Phase 4 统一更新 |

当前阶段为设计评审。文档确认后从 Phase 0 开始实现，不恢复已清除的局部 merge 方案。

### 11.2 Phase 0：Run 身份与结果存储

改动：

- 为所有 Session Run 建立稳定 `runId`。
- 给活动 Run 事件和 `session_sync` 增加 `runId`。
- 实现 `DelegationResultRecord` 存储接口。
- 使用 workspace 下的 run 级原子 JSON sidecar 保存结果。
- delegated run 进入终态时先固化结果，再更新可观察状态。
- `get_delegation_results` 改为精确读取当前 `{delegationId, runId}`。
- 将现有长时 `runSessionOperation` 拆分为短时 Session Command Gate 和 Gate 外的 Runtime completion。

完成标准：

- 同一次 delegated run 在 Session、事件和 Delegation 中使用相同 `runId`。
- completed、failed 和 cancelled 结果跨应用重启可读取。
- 后续 desktop run 不改变历史 delegated run 结果。
- 缺少结果记录时返回 `result_unavailable`。
- 活动 Run 中的 enqueue、correction 和 stop 不会等待 Run 完成后才执行。

### 11.3 Phase 1：普通输入与显式继续

改动：

- 实现 `SessionInteraction.submitUserMessage`。
- renderer 删除 chat/queue 分流，统一提交用户消息。
- 删除普通输入中的隐式 `continueDelegation`。
- 文本、附件和 `messageId` 使用统一合同。
- `continue_delegation` 增加 Session 空闲校验和 `child_session_busy` 返回。
- stop 增加 `expectedRunId` 校验。

完成标准：

- 普通 Session 和子 Session 使用同一个发送接口。
- 发送与 Run 状态切换竞态由主进程完成唯一决策。
- 委派终态后的子 Session 可以像普通 Session 一样继续聊天。
- 历史 `delegationStatus`、`delegationRunId` 和 `delegationAttempt` 保持不变。
- 父会话不会重新等待该 desktop run。
- 父 Agent 显式 continue 遇到活动 desktop run 时不修改委派元数据。

### 11.4 Phase 2：编辑修正原子化

改动：

- 删除 `MessageList.startEditing` 中的 stop。
- 用 `submitUserEdit` 替换 renderer 的 revise 分支判断。
- 传递 `EditIntent` 和 `observedRunId`。
- 实现 `steered`、`started_correction`、`revised` 和 `state_changed` 四种结果。
- 增加 correction 关联元数据和 UI 展示。

完成标准：

- 运行中编辑不会停止 Run。
- correction 被同一个 `runId` 接收。
- Run 在编辑提交前结束时，已完成输出保持可见，新 desktop run 处理 correction。
- 另一个 Run 已开始时不修改历史。
- 普通 Session 和子 Session 共用同一接口和测试。

### 11.5 Phase 3：Session Timeline Projection 与 UI 状态

改动：

- 实现 snapshot replace 和 same-run event 投影。
- 实现投影周期开始时的事件缓冲与活动 Run 重放。
- 删除本地消息数组全量合并路径。
- 统一 pending message 的稳定 ID 和接受状态。
- 忽略旧 `runId` 的迟到事件。
- 区分侧边栏 Session activity 与 Delegation status。

完成标准：

- 完整历史按 JSONL 顺序展示。
- 当前流式输出在 snapshot 后按同一 `runId` 连续更新。
- 相同消息不重复。
- 旧 Run 事件不能写入新 Run 时间线。
- 历史 Delegation 已完成且 desktop run 活动时，界面同时正确表达两类状态。

### 11.6 Phase 4：端到端闭环

改动：

- 完成用户旅程对应的真实 Provider E2E。
- 同步 `docs/subtask-delegation.md`、IPC 类型和 preload 接口。
- 执行 L1、L2、L3、typecheck 和 Live SDK 诊断。

完成标准：

- 本文所有验收项通过。
- 原始事故可以通过稳定 E2E 复现旧行为并验证新行为。
- Feature 状态更新为已完成，并记录实际测试结果。

### 11.7 文档同步

实现过程中同步更新：

- `docs/subtask-delegation.md` 的用户继续会话规则。
- IPC 类型和 preload 接口说明。
- Feature 状态和测试结果。

## 十二、测试计划

### 12.1 L1 Unit

| 被测内容 | 断言 |
| --- | --- |
| correction 文本构造 | 原文本、新文本和目标 messageId 正确 |
| correction UI 投影 | 原消息保留，新消息关联目标消息 |
| 编辑决策矩阵 | `intent`、`observedRunId` 和活动 Run 的组合得到正确 mode |
| snapshot replace | snapshot 顺序成为权威持久化顺序 |
| same-run event | snapshot 后的同 run 事件按顺序进入时间线 |
| stale event | 旧 `runId` 事件不改变当前时间线 |
| 投影幂等 | 重复应用相同 snapshot 和事件不产生重复消息 |
| Delegation 结果键 | `{delegationId, runId}` 精确读写，重复终态提交幂等 |

### 12.2 L2 Integration

| 被测内容 | 断言 |
| --- | --- |
| 空闲普通 Session 发送 | `submitUserMessage` 启动 desktop run |
| 活动普通 Session 发送 | 同一 `runId` enqueue，不启动第二个 Run |
| 两次并发空闲发送 | 一个请求启动 Run，另一个请求 enqueue 到该 Run |
| Command Gate 临界区 | enqueue、correction 和 stop 在 Run 完成前得到提交结果 |
| 空闲子 Session 普通发送 | 启动 desktop run，delegation attempt 不变 |
| 普通发送附件 | Runtime 收到附件 |
| 发送与 Run 状态切换竞态 | 只产生 started 或 enqueued 一个完整结果 |
| 活动 delegated run 接收 correction | 同一 runId，delegation 保持 running |
| correction 与原 Run 结束竞态 | 保留完成历史，返回 `started_correction` |
| correction 提交前新 Run 启动 | 返回 `state_changed`，不修改历史 |
| 空闲历史编辑 | 返回 `revised`，按目标消息改写并启动 desktop run |
| desktop run 停止 | 历史 delegation 终态不变 |
| stop 与 Run 切换竞态 | `expectedRunId` 不匹配时不停止新 Run |
| 父 Agent 显式 continue，Session 空闲 | 新 runId，attempt 增加 |
| 父 Agent 显式 continue，desktop run 活动 | 返回 `child_session_busy`，委派元数据不变 |
| delegated run 终态提交 | 结果记录先写入，随后解除 wait |
| delegated run 完成后普通聊天 | 父会话仍读取原 run 固化结果 |
| 应用重启后读取结果 | 返回相同的 `DelegationResultRecord` |
| 终态提交中途退出后恢复 | 结果记录存在时补齐同 run 的 SessionMeta 终态 |
| snapshot 与实时事件 | snapshot 首发，同 run 事件连续，旧 run 事件被忽略 |
| 活动 Run 投影恢复 | snapshot 后重放未持久化事件，再接收实时事件 |

建议位置：

- `tests/integration/session-correction-flow.test.ts`
- `tests/integration/subtask-session-semantics.test.ts`

### 12.3 L3 E2E

E2E 使用真实 Electron、真实 Provider 和可见界面操作。测试需要检查 Agent Trace 和最终结果。

| 用例 | 用户操作 | 关键断言 |
| --- | --- | --- |
| E2E-J0 | 父会话创建子任务，无用户介入 | 子任务完成，父会话回复包含真实成果 |
| E2E-J1 | delegated run 中向子会话发送引导 | 同一 run 继续，Trace 出现后续处理，父会话最终获得结果 |
| E2E-J2 | delegated run 中修正消息 | 无 stopped 事件，原消息保留，修正被吸收，delegation 最终 completed |
| E2E-J3 | 打开运行中编辑器，等待原 Run 完成后提交 | 已完成回复保留，新 desktop run 处理 correction，原结果不变 |
| E2E-J4 | delegation 完成后在子会话发送普通消息 | 启动 desktop run，attempt 和 delegationRunId 不变，父会话不重新进入等待 |
| E2E-J5 | J4 同时携带附件 | Agent 能读取附件内容 |
| E2E-J6 | J4 完成后父 Agent 再次读取原委派结果 | 返回 delegated run 的固化结果，不包含 desktop run 的独立回答 |
| E2E-J7 | desktop run 活动时父 Agent 显式 continue | 返回忙碌状态，不改变 attempt 和 delegationRunId；空闲后重试创建新 runId |
| E2E-J8 | delegated run 中显式停止 | delegation 进入 cancelled，父会话如实说明 |
| E2E-J9 | 子 Session 的 desktop run 中编辑和停止 | 行为与普通 Session 相同，历史 Delegation 不变 |
| E2E-J10 | 打开或恢复有历史和活动 Run 的子会话 | 历史、当前消息和 Agent Trace 顺序稳定，无重复消息 |
| E2E-J11 | 子任务触发权限请求并由子会话处理 | 父会话等待恢复，delegation 最终完成 |
| E2E-J12 | 父会话等待超时 | 子任务继续运行，父会话不把 timeout 表述为终态 |
| E2E-J13 | 父会话运行被停止 | 子 delegated run 继续，后续可以查询固化结果 |
| E2E-J14 | 历史 Delegation 完成，当前 desktop run 活动 | 侧边栏显示当前运行，父会话聚合仍显示委派已完成 |

核心回归用例为 J2、J3、J4、J5、J6、J7 和 J10。它们覆盖原始编辑事故、编辑提交竞态、隐式继续委派、附件丢失、结果污染、Run 互斥和消息顺序错乱。

### 12.4 验证命令

```bash
bun run test:unit
bun run test:integration
bun run typecheck
bun run test:e2e
bun run test:live
```

Bug 修复必须把对应事故固化为测试断言。E2E 失败时保留截图和 renderer 日志。

## 十三、风险与处理

### 13.1 steer 对修正的吸收时机

现有 `beforeToolCall` 会在下一次工具调用前处理 pending steering message。当前工具可能已经执行完成，correction 无法撤销已产生的外部副作用。

处理：

- correction 文案明确要求基于修正继续。
- E2E 使用真实 Provider 验证后续行为。
- 发现稳定复现的延迟吸收后，再评估 Proma 式硬 interrupt。

### 13.2 编辑与 Run 结束竞态

renderer 快照无法解决该竞态。主进程的 session 级提交接口必须决定唯一结果，并保证持久化记录与 Runtime 接收一致。

处理：

- 编辑态记录 `EditIntent` 和 `observedRunId`。
- 提交时在 session 级串行操作内比较真实活动 Run。
- 原 Run 已结束时保留已完成历史，通过新的 desktop run 处理 correction。

### 13.3 远距离消息修正

模型对较早消息的修正依赖 correction 中的原文和目标关系。

处理：

- 第一版允许修正任意用户消息。
- E2E 覆盖最近一条消息。
- 若真实使用出现稳定理解偏差，再限制运行中只能修正最近一条已发送用户消息。

### 13.4 delegated run 结果完整性

当前实现从整个子 Session 中反向查找最后一条 assistant 消息。delegated run 完成后的 desktop run 会改变该查询结果。

处理：

- 终态时按 `{delegationId, runId}` 固化结果。
- 先持久化结果，再发布委派终态并解除 wait。
- 读取结果时禁止回退到 Session 最后一条 assistant。

### 13.5 Continue 与活动 desktop run 冲突

当前 continue 路径只检查 `delegationStatus`，可能先修改元数据，再因 Session 已有活动 Run 而启动失败。

处理：

- continue 与用户输入共用 session 级串行边界。
- 任何活动 Run 都返回 `child_session_busy`。
- Run 确认可启动后再提交新的委派元数据。

### 13.6 Run ID 传播遗漏

snapshot、stream event、stop 或 correction 中任一链路缺少 `runId`，都会重新引入旧 Run 事件污染新 Run 的可能性。

处理：

- 建立统一 `RunScopedEvent` 类型。
- L1 检查投影拒绝旧 Run 事件。
- L2 覆盖 Run 切换期间的 stop、edit 和 snapshot。
- E2E 覆盖窗口恢复和连续多 Run。

### 13.7 结果记录缺失

旧 delegated run 没有 `DelegationResultRecord`。从 Session 最新 assistant 推导会返回含义不确定的结果。

处理：

- 返回 `result_unavailable`。
- 不增加兼容读取和迁移脚本。
- 新 delegated run 必须通过终态提交路径写入结果。

### 13.8 子 Session 的能力差异

子 Session 仍受单层委派约束，不注册 subtask 工具。delegated run 不触发 Memory Agent；用户在子 Session 中启动的 desktop run 按普通会话规则调度 Memory Agent。统一会话语义覆盖发送、编辑、停止和历史展示，不改变单层委派限制。

### 13.9 Session Command Gate 边界

现有 `runSessionOperation` 在 Runtime 完成前持续占用同一 Session 的操作队列。直接复用会使 queue、correction 和 stop 无法及时进入。

处理：

- Gate 只覆盖 ActiveRun 状态判断和命令提交。
- Runtime completion 在 Gate 外等待，终态提交重新进入 Gate。
- AgentExecutionService 在 Gate 释放前完成 ActiveRun 注册。
- L2 验证长 Run 活动期间追加消息和 stop 可以完成。

### 13.10 活动 Run 投影缓冲

renderer 重连时需要恢复尚未持久化的 assistant、thinking 和工具事件。只发送消息 snapshot 会丢失当前 Agent Trace。

处理：

- 主进程仅缓存当前活动 Run 的投影事件。
- snapshot 创建期间继续接收并缓冲事件，snapshot 发出后按序重放。
- Run 终态消息持久化完成后释放缓冲。
- L2 和 E2E 验证恢复期间无丢失、重复和乱序。

## 十四、验收标准

- [ ] 用户在普通 Session 和子 Session 中执行相同操作时，发送、编辑和停止语义一致。
- [ ] renderer 通过单一 `submitUserMessage` 接口发送，不根据本地 `isRunning` 选择 chat 或 queue。
- [ ] `parentSessionId` 不再使普通输入进入 `continue_delegation`。
- [ ] 委派结束后的子 Session 普通聊天使用 `source: "desktop"`。
- [ ] 普通子 Session 输入中的附件完整进入 Runtime。
- [ ] Session Command Gate 不持有到 Runtime completion，活动 Run 中的发送、修正和停止可以及时提交。
- [ ] 运行中编辑不调用 stop。
- [ ] correction 进入匹配 `observedRunId` 的活动 Run，`runId` 不变。
- [ ] 原 Run 在编辑期间结束时，已完成输出保持可见，correction 由新的 desktop run 处理。
- [ ] 编辑提交前另一个 Run 已启动时返回 `state_changed`，不修改历史或停止新 Run。
- [ ] 空闲编辑重写历史并启动 desktop run。
- [ ] 编辑竞态不会留下未被 Run 接收的 correction。
- [ ] 用户发送引导或 correction 不增加 delegation attempt，不改变 delegation 状态。
- [ ] 父 Agent 显式 continue 会创建新 runId 并增加 attempt。
- [ ] 子 Session 有活动 desktop run 时，显式 continue 返回 `child_session_busy`，委派元数据不变化。
- [ ] stop 的 `expectedRunId` 不匹配时不会停止新 Run。
- [ ] delegated run 终态结果按 `{delegationId, runId}` 持久化。
- [ ] delegated run 完成后的普通聊天和应用重启不改变父会话读取到的结果。
- [ ] 缺少结果记录时返回 `result_unavailable`，不扫描 Session 最新 assistant。
- [ ] wait 超时不终止子任务，也不被描述为失败或取消。
- [ ] 所有 Session Run 和活动 Run 事件使用稳定 `runId`。
- [ ] `session_sync` 作为 Run 的首个投影事件，按持久化顺序替换时间线。
- [ ] snapshot 后的同 run 事件连续应用，旧 run 迟到事件被忽略。
- [ ] 活动 Run 恢复时，snapshot 后重放未持久化投影事件，再继续实时事件。
- [ ] pending message 被主进程接受后按稳定 `messageId` 去重。
- [ ] Session activity 与 Delegation status 在侧边栏和父会话聚合中分别使用。
- [ ] L1、L2、L3 对应测试全部通过。
- [ ] `bun run test:live` 通过。
- [ ] `bun run typecheck` 通过。

## 十五、证据索引

- 父会话：`~/.zora/workspaces/0edc05bd-ed2f-4cb3-965a-857c73caa455/sessions/06fd1696-d8e3-4235-92c5-f20d02a95a2c.jsonl`
- 子会话：`~/.zora/workspaces/0edc05bd-ed2f-4cb3-965a-857c73caa455/sessions/eda4e645-7055-4afe-af39-1946853f3d43.jsonl`
- 方案讨论会话：`~/.zora/workspaces/1fb11b0e-db02-427b-b4c8-cdeefc29c1d9/sessions/8ec99261-0e86-4c69-a18e-1c0a2a3d30d5.jsonl`
- 主进程日志：`~/.zora/logs/zora-2026-08-17.jsonl`
- 普通输入分支：`src/main/index.ts` 的 `agent:chat`
- 运行中 queue：`src/main/index.ts` 的 `agent:queue-message`
- 编辑入口：`src/renderer/components/chat/MessageList.tsx`
- 历史修改：`src/main/session-runner.ts` 的 `revisePromptInSession`
- 委派协调：`src/main/delegation/coordinator.ts`
- 委派结果读取：`src/main/delegation/coordinator.ts` 的 `getResults` 与 `toSummaryWithPersistedResult`
- 当前结果摘要推导：`src/main/delegation/result-summary.ts` 的 `extractLastAssistantText`
- 活动 Run 管理：`src/main/agent-execution-service.ts`
- 快照发布：`src/main/session-sync.ts` 的 `emitSessionSync`
- 消息投影入口：`src/renderer/App.tsx` 的 agent control event handler
- Proma 参考：`apps/electron/src/main/lib/adapters/pi-agent-adapter.ts` 与 `AgentMessageQueue.tsx`
