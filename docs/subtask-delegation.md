# 子任务委派设计

## 目标

子任务委派用于把可以独立完成的代码检索、资料查找和审查工作交给并行子 Agent。每项委派直接对应一个 Zora 子会话，用户可以查看完整过程、处理权限请求、继续对话并独立归档。

父会话负责拆分任务、等待结果和形成最终回复。子任务只有一层，不允许继续创建子任务。

## 会话模型

子任务复用产品会话存储，通过以下字段关联父会话：

- `SessionMeta.id` 同时作为 `delegationId`。
- `parentSessionId` 指向创建它的普通会话。
- `rootSessionId` 指向会话树根节点。
- `delegationDepth` 固定为 `1`。
- `delegationRole` 取值为 `explore` 或 `review`。
- `delegationStatus` 保存运行、完成、失败、停止或中断状态。

子任务继承父会话的工作目录，使用独立 Session JSONL 和 Runtime checkpoint。应用重启时，仍处于运行状态的子任务标记为已中断，不在后台静默恢复。

每次 Session 执行都有稳定 `runId`。父 Agent 创建或显式继续产生 delegated run，`delegationRunId` 与该 Session runId 相同。用户直接在子会话发送、修正或停止时遵循普通会话语义；委派结束后的普通输入启动独立 desktop run，不增加 attempt，也不改变历史委派状态。

## 运行目标与权限

没有显式选择时，子任务继承父会话当前的 Provider、模型和 Runtime。父 Agent 可以从已启用 Provider 的候选列表中选择其他运行目标；显式选择必须使用同一条候选记录中的 `providerId`、`modelId` 和受支持 Runtime。

角色只描述探索或审查目标。工具授权由子会话自己的 Ask、Smart 或 YOLO 模式决定：

- 默认继承父会话权限模式。
- 创建时可以请求更严格的模式。
- 子任务不能获得高于父会话的权限。
- 子任务产生的权限请求会显示在父会话和子会话界面，用户在任一入口处理后继续运行。

子任务可以使用普通会话工具，但不注册新的 subtask 工具。delegated run 不触发 Memory Agent；用户在子会话中直接启动的 desktop run 按普通会话规则调度 Memory Agent。Inspect Image 与普通会话使用相同的模型能力和视觉中转规则。

## 工具合同

父会话使用以下内置工具管理子任务：

| 工具 | 行为 |
| --- | --- |
| `list_available_models` | 列出可用于子任务的 Provider、模型和 Runtime。 |
| `delegate_agent` | 创建一个子任务并立即返回。 |
| `delegate_agents` | 批量创建最多十个子任务，允许部分成功。 |
| `wait_for_delegations` | 等待指定子任务完成、需要输入或达到等待时限。 |
| `list_delegations` | 列出当前父会话的全部子任务。 |
| `get_delegation_results` | 获取指定子任务的最终结果摘要。 |
| `respond_to_delegation` | 回答子任务提出的问题；调用本身需要用户确认。 |
| `continue_delegation` | 在保留历史的情况下继续已结束的子任务。 |
| `stop_delegation` | 按当前 `runId` 停止运行中的子任务。 |

创建和继续操作以 Runtime 工具调用 ID 作为幂等键。停止和继续必须携带调用方最近观察到的 `runId`，避免迟到事件覆盖新一轮运行。子会话存在活动 desktop run 时，`continue_delegation` 返回 `child_session_busy`，且不会提前修改委派元数据。

## 并发与等待

- 每个父会话最多同时运行十个子任务。
- 单个 workspace 最多同时运行二十个子任务。
- 批量创建一次最多接受十项任务。
- `wait_for_delegations` 默认等待五分钟，最长十分钟。
- 等待超时只结束本次等待，子任务继续运行。
- 父运行取消时终止其等待订阅，不自动停止已经创建的子任务。

等待采用指定 `delegationId` 的快照与事件共同判断。返回状态为全部或部分结束、需要输入、等待超时；完成结果直接携带摘要，父 Agent 无需让子任务重复输出。

## 结果与界面

每个子任务的完整历史保存在自己的会话中。delegated run 进入终态时，系统先按 `{delegationId, runId}` 原子写入结果记录，再更新 SessionMeta 并解除父会话等待。`get_delegation_results` 只读取该 run 的固化结果，不扫描子会话最后一条 assistant。委派完成后的普通聊天、历史编辑和应用重启不会改变原结果。

`resultSummary` 最多保存 50,000 个字符；发生截断时附带明确说明并引导打开子会话查看完整记录。结果记录位于 workspace 的 `delegation-results/{delegationId}/{runId}.json`，永久删除会话时同步清理。

侧边栏在父会话下显示子任务、完成数量和聚合状态。用户可以：

- 展开或收起子任务列表。
- 打开子会话查看 Agent Trace 和完整对话。
- 在父会话或子会话处理待确认操作。
- 修正运行中的消息并保持当前 delegated run 活动。
- 停止运行中的子任务，并把同一子会话作为普通会话继续使用。
- 单独归档子任务，或归档、恢复整个父子会话树。

子会话行不显示运行、待确认、完成、失败或停止状态文本。当前活动由状态点和正文运行区表达，完成数量由父会话的聚合进度表达。聚合进度只统计状态为 `completed` 的委派。

运行中或等待用户输入的会话不能归档。删除父会话时级联删除其全部子任务；fork 子会话时生成普通独立会话，不复制委派关系。

## 验收标准

- 父 Agent 可以创建一个或多个真实子会话并并行运行。
- 子任务在侧边栏可见，刷新后仍能恢复父子关系和终态。
- 父 Agent 能等待指定子任务并取得最终结果摘要。
- 委派结果按 run 固化，后续 desktop run 不改变父会话读取结果。
- 子会话恢复时按 snapshot 和同 run 实时事件重建时间线，消息顺序稳定且无重复。
- 子任务的 Provider、模型、Runtime 和权限模式符合选择与继承规则。
- Ask 权限请求在用户处理前保持阻塞，父会话与子会话显示同一请求状态。
- 停止、继续、重启和迟到事件不会覆盖较新的 `runId` 状态。
- 归档、恢复、删除和 fork 按父子会话生命周期合同执行。
