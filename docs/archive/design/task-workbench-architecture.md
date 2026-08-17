# Zora 任务工作台架构与迁移方案

> 调研范围：Zora、Multica、Cindy，以及 Zora 仓库内的 Claude Agent SDK 官方参考。
>
> 目标：以任务面板为首个产品切口，把 Zora 从会话入口升级为围绕工作目标持续推进的 AI 办公工作台。

## 1. 架构结论

Zora 当前已经具备四项可复用基础能力：Project 级工作目录、持久 Session、Agent 运行链路、定时触发。缺少的核心层是一个稳定的 **Task 聚合层**。

建议将目标关系确定为：

```text
Project（现有 Workspace 的产品名称）
└── Task（持续存在的工作目标）
    ├── Conversations（一个或多个 Session）
    ├── Runs（每次 Agent 执行尝试）
    ├── Automations（触发规则，可选）
    ├── Squad / Workers（协作执行，可选）
    ├── Artifacts（结果与文件，可选）
    └── Activity（状态变更与审计记录）
```

产品第一阶段应聚焦 Task、Conversation、Run 三个实体。Automation 接入第二步完成。Squad 放在 Task 与 Run 稳定后建设。

核心判断包括：

- Task 状态表示工作目标的进度。
- Run 状态表示某次 Agent 执行的进度。
- Conversation 保存连续上下文和消息。
- Automation 保存何时、以什么方式触发工作。
- Squad 保存如何路由与协调多个执行参与者。

这套分层与 Multica 的 Issue、AgentTask、ChatSession 分工一致。Multica 源码显示，三类状态独立维护；Squad 通过 leader 路由进入执行链路。[Multica 研究稿](../research/multica-task-squad-architecture.md)

## 2. 当前结构与缺口

### 2.1 现有实体

Zora 当前的 `WorkspaceMeta` 只有 id、name、path 和时间字段，产品上已经接近一个本地 Project。[`src/shared/zora.d.ts:119-125`](../../src/shared/zora.d.ts#L119)

每个普通 Workspace 创建时必须指定目录，Session 默认复用该目录；默认 Workspace 为每个 Session 创建托管目录。[`src/main/workspace-store.ts:383-412`](../../src/main/workspace-store.ts#L383) [`src/main/session-store.ts:229-240`](../../src/main/session-store.ts#L229)

`SessionMeta` 当前包含标题、SDK session、模型、工作目录、分支信息和归档时间，没有 Task 归属、业务状态、执行来源或结果摘要。[`src/shared/zora.d.ts:74-102`](../../src/shared/zora.d.ts#L74)

定时任务独立存储，只有 active/paused、计划、下次运行时间和累计成功/失败计数。[`src/shared/types/schedule.ts:1-58`](../../src/shared/types/schedule.ts#L1)

定时任务触发时会创建一个新 Session，执行结束后只更新累计计数。当前没有单次 Run 记录，也没有从定时任务稳定关联到历次 Session 的结构。[`src/main/schedule-runner.ts:88-145`](../../src/main/schedule-runner.ts#L88)

前端主视图只有 chat、schedule、settings，Task 还不是一级产品入口。[`src/renderer/store/ui.ts:1-3`](../../src/renderer/store/ui.ts#L1) [`src/renderer/components/layout/AppShell.tsx:15-54`](../../src/renderer/components/layout/AppShell.tsx#L15)

### 2.2 当前状态已经可以提供的 Task 信号

侧边栏已经能够按 Session 聚合以下运行信号：

- 等待权限或用户回答；
- Agent 运行中；
- 当前选中；
- 空闲。

这些逻辑目前是前端根据运行集合和 HITL 集合派生的临时投影。[`src/renderer/components/sidebar/SessionList.tsx:327-392`](../../src/renderer/components/sidebar/SessionList.tsx#L327)

它们可以成为 Task 面板的实时状态输入，但不应直接写入 Task 的业务状态。

### 2.3 主要缺口

| 领域 | 现状 | 影响 |
|---|---|---|
| 工作目标 | Session 同时承担入口、历史和工作身份 | 无法让一个任务容纳多个会话或多次执行 |
| 生命周期 | 只有 Session archivedAt 和 Agent running | 无法表示待处理、进行中、审核、阻塞、完成 |
| 执行记录 | 定时任务只有累计次数 | 无法查看单次结果、失败原因、重试与费用 |
| 自动化 | Schedule 与 Session 松散连接 | 用户无法从 Task 追踪自动执行过程 |
| 协作 | SDK 运行过程未形成可管理 Worker 实体 | 无法在任务面板中分派、停止、恢复或查看分工 |
| 前端 | 侧边栏以 Project/Session 列表为中心 | 工作优先级和待处理状态不可见 |

## 3. 产品实体关系

### 3.1 Project

产品层统一使用 Project。第一阶段保留代码和存储中的 `workspaceId`，避免同时进行大范围重命名和数据迁移。

建议扩展字段：

```ts
interface ProjectMeta {
  id: string;
  name: string;
  path: string;
  kind: "managed" | "folder";
  description?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

- `folder` 对应用户选择的真实目录。
- `managed` 对应 Zora 管理的办公项目目录，适合没有现成文件夹的通用办公任务。
- 第一阶段可只在产品文案上使用 Project，后续再迁移类型名称。

### 3.2 Task

Task 是任务面板的主实体，表示一个可追踪的工作目标。

```ts
type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "blocked"
  | "done"
  | "cancelled";

interface Task {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: "none" | "low" | "medium" | "high" | "urgent";
  assignee: TaskAssignee;
  parentTaskId?: string;
  position: string;
  dueAt?: string;
  startedAt?: string;
  completedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

第一版可以将状态缩减为 `todo / in_progress / blocked / done / cancelled`，但存储和迁移方案应允许增加 `backlog / in_review`。人工审核对办公交付很重要，建议尽早保留 `in_review`。

### 3.3 Conversation

继续复用 Session 作为 Conversation 的实现。新增显式关联：

```ts
interface TaskConversationLink {
  taskId: string;
  sessionId: string;
  role: "primary" | "supporting" | "worker";
  createdAt: string;
}
```

推荐使用关联实体，不在 Task 上保存单个 `sessionId`。它支持：

- 一个 Task 下保留主会话；
- 从某条消息 fork 辅助会话；
- 自动化每次执行创建独立会话；
- Squad 的 Worker 使用独立上下文；
- 未来将现有 Session 关联到 Task。

### 3.4 Run

Run 表示一次明确的执行尝试，状态机需要严格保护。

```ts
type TaskRunStatus =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "succeeded"
  | "failed"
  | "cancelled";

interface TaskRun {
  id: string;
  taskId: string;
  sessionId: string;
  automationId?: string;
  parentRunId?: string;
  attempt: number;
  trigger: "manual" | "conversation" | "schedule" | "squad" | "retry";
  status: TaskRunStatus;
  resultSummary?: string;
  error?: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
}
```

Run 的 `waiting_for_user` 可由 HITL 请求派生并记录。Task 仍保留自己的业务状态；等待用户期间，Task 可显示 attention 标识，是否转为 blocked 由用户或 Task policy 决定。

### 3.5 Automation

将现有 `ScheduledTask` 逐步更名为 Automation。它是触发定义，不占用 Task 的业务状态。

```ts
type AutomationTargetMode =
  | "continue_task"
  | "new_run"
  | "new_task_from_template";

interface Automation {
  id: string;
  workspaceId: string;
  taskId?: string;
  taskTemplateId?: string;
  title: string;
  prompt: string;
  status: "active" | "paused";
  targetMode: AutomationTargetMode;
  schedule: ScheduledTaskSchedule;
  nextRunAt: string;
}
```

三种模式分别适合：

- `continue_task`：持续监控、周期汇总，在同一 Task 和主会话中积累上下文；
- `new_run`：同一工作目标下保留独立执行记录和独立 Session；
- `new_task_from_template`：每天生成一条新的日报、审核或跟进任务。

### 3.6 Squad

Squad 应包含模板和任务实例两个层次：

```ts
interface SquadDefinition {
  id: string;
  workspaceId: string;
  name: string;
  instructions?: string;
  leaderRoleId: string;
  roles: SquadRoleDefinition[];
}

interface TaskSquad {
  id: string;
  taskId: string;
  squadDefinitionId?: string;
  leaderSessionId: string;
  status: "active" | "completed" | "cancelled" | "failed";
}

interface TaskWorker {
  id: string;
  taskSquadId: string;
  sessionId: string;
  label: string;
  role: string;
  status: "idle" | "running" | "done" | "error";
}
```

SquadDefinition 负责复用角色和协作说明；TaskSquad 记录某个 Task 的实际协作现场。这样修改模板不会改变进行中的 Task。

## 4. 生命周期规则

### 4.1 Task 状态机

推荐的常规路径：

```text
backlog → todo → in_progress → in_review → done
             └───────→ blocked ────────┘

任意非终态 → cancelled
blocked → todo | in_progress
in_review → in_progress
done | cancelled → todo（重新打开）
```

Task 转移应通过一个 `TaskLifecycle` module 完成，前端不可直接修改状态文件。它的外部 interface 可以保持为：

```ts
interface TaskLifecycle {
  create(input: CreateTaskInput): Promise<Task>;
  transition(input: TransitionTaskInput): Promise<TaskTransitionResult>;
  update(input: UpdateTaskInput): Promise<Task>;
  attachConversation(input: AttachConversationInput): Promise<void>;
  startRun(input: StartTaskRunInput): Promise<TaskRun>;
  finishRun(input: FinishTaskRunInput): Promise<TaskRun>;
  getSnapshot(taskId: string): Promise<TaskSnapshot>;
}
```

状态转移、时间字段、Activity 记录、Run 绑定和事件发送全部由 implementation 处理。Renderer、ScheduleRunner、SessionRunner 通过同一个 seam 调用。

### 4.2 Task 与 Run 的联动

建议规则：

| 事件 | Run 变化 | Task 变化 |
|---|---|---|
| 用户开始执行 | queued → running | todo/backlog → in_progress |
| Agent 请求确认 | running → waiting_for_user | 保持原状态，增加 attention |
| 用户继续 | waiting_for_user → running | 保持原状态，清 attention |
| Agent 正常结束 | running → succeeded | 默认进入 in_review；用户可选择自动完成策略 |
| Agent 失败 | running → failed | 保持 in_progress 或回到 todo；增加 error attention |
| 用户停止执行 | active → cancelled | Task 保持原状态 |
| 用户取消 Task | Task → cancelled | 活跃 Run 是否停止需要单独确认 |

其中“Task 完成”和“停止 Run”是两项独立操作。Multica 也采用该规则：Issue 改为 done/cancelled 不隐式停止正在执行的 AgentTask。[Multica 研究稿 §3.4](../research/multica-task-squad-architecture.md#34-终止-issue-不等于停止执行)

### 4.3 转移权限

建议在 Task policy 中明确三类写入者：

- 用户可以执行全部合法转移；
- Agent 可以将 Task 推进到 in_progress、in_review、blocked；
- Automation 可以创建 Run 或 Task，不能直接将人工工作标记为 done；
- 系统恢复逻辑可以在无其他 active Run 时将失败 Task 从 in_progress 回到 todo。

Agent 提议的高影响转移可以复用 Zora 现有 HITL 机制确认。

### 4.4 Activity 事件

每次重要变化写入 append-only Activity：

```ts
type TaskActivityType =
  | "task_created"
  | "task_updated"
  | "status_changed"
  | "conversation_attached"
  | "run_started"
  | "run_waiting"
  | "run_finished"
  | "automation_triggered"
  | "worker_created"
  | "worker_finished";
```

Activity 是任务详情时间线和问题诊断的共同事实源。Task 与 Run 当前状态仍以快照存储，首版无需实现完整 event sourcing。

## 5. Squad 的迁移切入

### 5.1 Multica 的可迁移部分

Multica 的 Squad 包含 leader、成员、自由文本角色和 instructions。Issue 分配给 Squad 后，平台把首次 Run 路由给 leader；leader 通过 mention 或子 Issue 委派。父任务的当前 stage 完成后，平台再次唤醒 leader。[Multica 研究稿 §5](../research/multica-task-squad-architecture.md#5-squad-管理与调度)

Zora 可以迁移以下能力：

1. Task 的 assignee 支持 `user | agent | squad`；
2. Squad assignment 统一解析到 leader；
3. leader 启动时注入 roster、roles、instructions 和 Task snapshot；
4. 每次委派建立 `Delegation` 记录，包含目标 Worker、子目标和幂等键；
5. Worker 完成后更新 TaskWorker，并向 leader 添加结构化回报事件；
6. Task 详情展示所有 Worker、状态、结果和关联会话。

建议补充 Multica 当前依赖 prompt 的重复委派约束。Zora 的 `Delegation` 应提供 `idempotencyKey`，防止 leader 对同一子目标同时创建两个执行。

### 5.2 Claude Agent SDK 的适配方式

官方 SDK 支持通过 `agents` 参数定义 subagent，使用 Task tool 调用；subagent 有独立上下文、工具限制和模型配置。[`claude_agent_sdk_ref/Subagents in the SDK.md:7-22`](../../claude_agent_sdk_ref/Subagents%20in%20the%20SDK.md#L7)

SDK 消息可以通过 Task tool use 与 `parent_tool_use_id` 检测 subagent 活动；subagent ID 可以在同一个 SDK Session 中恢复。[`claude_agent_sdk_ref/Subagents in the SDK.md:269-271`](../../claude_agent_sdk_ref/Subagents%20in%20the%20SDK.md#L269) [`claude_agent_sdk_ref/Subagents in the SDK.md:353-366`](../../claude_agent_sdk_ref/Subagents%20in%20the%20SDK.md#L353)

因此建议把 SDK 作为 Squad Execution Adapter：

- Zora TaskSquad、TaskWorker、Delegation 是产品事实源；
- SDK agentId、parent_tool_use_id、background taskId 是执行映射；
- Agent 运行事件由 adapter 转换为 TaskWorker 与 Run 事件；
- Task panel 不直接依赖某个 SDK 的内部 task 状态。

SDK subagent 当前不能继续生成下一层 subagent，并且 AskUserQuestion 在 subagent 中受限。Squad 的用户确认统一交给 leader Session 和 Zora HITL 层处理。[`claude_agent_sdk_ref/Subagents in the SDK.md:154-165`](../../claude_agent_sdk_ref/Subagents%20in%20the%20SDK.md#L154) [`claude_agent_sdk_ref/Handle approvals and user input.md:742`](../../claude_agent_sdk_ref/Handle%20approvals%20and%20user%20input.md#L742)

### 5.3 Squad 建设顺序

1. 先可视化 SDK 已产生的 subagent activity，只读展示；
2. 增加 TaskWorker 和 Run 映射，支持停止与查看结果；
3. 增加固定角色 SquadDefinition；
4. 增加 leader 委派和结构化回报；
5. 增加子 Task、依赖和 stage barrier；
6. 最后增加复杂的多 Worker 并发、恢复和资源策略。

## 6. 前端信息架构

### 6.1 一级导航

建议将左侧导航调整为：

```text
收件箱
任务
自动化

项目
  Project A
  Project B

最近会话
设置
```

- 收件箱聚合等待确认、执行失败、待审核和即将到期；
- 任务提供跨 Project 的个人任务视图；
- 自动化承接现有 SchedulePage；
- Project 点击后进入 Project Home；
- 最近会话保留低成本的快速返回入口。

### 6.2 Project Home

Project Home 使用固定顶部上下文，主区域提供：

- 概览：进行中、待确认、最近结果；
- 任务：Board/List；
- 会话：该 Project 下的全部 Session；
- 文件：现有 FileTree；
- 自动化：按 Project 过滤。

Workspace 切换继续复用现有 `currentWorkspaceId`，但切换结果从“更换侧边栏分组”提升为“进入 Project 上下文”。

### 6.3 Task 面板

首版建议提供 Board 和 List 两种模式：

- Board 按 TaskStatus 分列；
- List 支持状态、优先级、Project、更新时间筛选；
- 拖拽调用 `TaskLifecycle.transition`；
- 乐观更新失败后回滚；
- TaskUpdated 与 RunUpdated 分开订阅。

Multica 的 IssueSurface 将 Workspace、Project 和 My Issues 复用同一视图内核，并把 scope 作为输入。这一模式适合 Zora：实现一个 `TaskSurface`，通过 scope 支持全局任务和 Project 任务，避免两套面板。[Multica 研究稿 §6.1](../research/multica-task-squad-architecture.md#61-issuesurface-是统一任务视图内核)

### 6.4 Task 详情

建议采用右侧详情面板或主区域详情页，内容顺序为：

1. 标题、状态、优先级、截止时间；
2. 目标描述和验收条件；
3. 当前进展摘要；
4. 主会话 composer；
5. Conversations、Runs、Workers、Artifacts、Activity 标签页；
6. 启动、停止、请求审核、完成等上下文动作。

用户从任务详情发送消息时，系统默认复用 primary Session，并为这次执行创建 Run。需要并行探索时再创建 supporting/worker Session。

## 7. 模块切分

建议新增以下模块：

```text
src/shared/types/task.ts
src/shared/types/task-run.ts
src/shared/types/task-activity.ts

src/main/task-lifecycle.ts       # 深模块，状态、规则、Activity、Run 绑定
src/main/task-store.ts           # Task 快照持久化 adapter
src/main/task-run-store.ts       # Run 持久化 adapter
src/main/task-query.ts           # TaskSnapshot 聚合查询
src/main/task-events.ts          # main → renderer 事件
src/main/task-session-link.ts    # Session 关联与兼容迁移

src/renderer/store/task.ts
src/renderer/components/task/TaskSurface.tsx
src/renderer/components/task/TaskBoard.tsx
src/renderer/components/task/TaskList.tsx
src/renderer/components/task/TaskDetail.tsx
```

外部 seam 保持在 `TaskLifecycle` 和 `TaskQuery`。Store 的文件格式、原子写入、事件分发和状态转换都属于 implementation。

第一阶段继续使用本地 JSON 存储：

```text
~/.zora/workspaces/{workspaceId}/
├── tasks/
│   ├── index.json
│   ├── runs.jsonl
│   └── activity.jsonl
├── sessions/
└── schedules/
```

当 Task、Run、Activity 数量增长并需要复杂筛选时，再迁移 SQLite。不要在第一版同时引入数据库迁移和新的产品模型。

## 8. 分阶段迁移

### Phase 0：产品语义与数据契约

目标：冻结实体定义，避免 UI 先行后反复迁移。

- 确认 Project、Task、Conversation、Run、Automation、Squad 的产品术语；
- 写 ADR，确定 Task 与 Run 分离；
- 定义状态、转移权限和 Activity 事件；
- 为现有 Session 和 ScheduledTask 设计兼容字段；
- 更新 `qa/gui/product-rules.md` 的任务面板验收规则。

完成标准：可以用一张实体图和一张状态表解释所有用户动作。

### Phase 1：Task 核心纵向切片

目标：用户可以在 Project 中创建、移动、打开和完成 Task。

- 新增 TaskLifecycle、TaskStore、Task IPC；
- Session 增加可选 Task link；
- 增加 TaskSurface 的 Board/List；
- Task 详情可以创建或关联 primary Session；
- 现有 Session 继续正常使用，未关联的 Session 归入“最近会话”；
- 增加 L1 状态转换测试、L2 Task/Session/IPC 测试、L3 任务面板剧本。

完成标准：Task 状态不依赖当前 Session 是否正在运行。

### Phase 2：Run 与 Attention

目标：任务详情可以解释每次 Agent 执行发生了什么。

- SessionRunner 启动时创建 Run；
- Agent started/finished/stopped/error/HITL 更新 Run；
- Task 详情增加 Runs 和 Activity；
- 收件箱聚合 waiting_for_user、failed、in_review；
- 支持停止单个 Run、重试并保留 parentRunId。

完成标准：任何自动或手动执行都能追溯到 Task、Session 和 Run。

### Phase 3：Automation 融合

目标：自动化成为 Task 的触发方式。

- ScheduledTask 产品名称改为 Automation；
- 增加 taskId、targetMode；
- ScheduleRunner 通过 TaskLifecycle 启动 Run；
- 为每次触发写 Run 和 Activity；
- 迁移旧 ScheduledTask，保留原 id、计划和累计计数；
- 增加执行历史和失败重试。

完成标准：用户可以从 Task 打开某次自动执行的 Session 和结果。

### Phase 4：Squad 基础

目标：一个 Task 可以由 leader 和多个 Worker 共同推进。

- 先接入只读 subagent activity；
- 新增 TaskSquad、TaskWorker、Delegation；
- 实现 leader 路由和结构化 Worker 回报；
- Task 详情增加 Workers 视图；
- 支持停止、恢复和失败重试；
- 增加权限、幂等和重启恢复测试。

完成标准：Worker 的上下文、状态和结果在应用重启后仍可恢复，Task 状态不由任意 Worker 直接覆盖。

### Phase 5：高级工作流

目标：支持复杂任务计划和可复用团队流程。

- 子 Task、依赖、stage barrier；
- Squad 模板与角色配置；
- 任务模板和 Automation 工厂模式；
- 跨 Project 总览、统计和费用；
- 多端同步与团队协作。

## 9. 第一批开发切入点

建议第一轮只做以下范围：

1. `Task`、`TaskStatus`、`TaskConversationLink` 类型；
2. JSON TaskStore 与 TaskLifecycle；
3. Project 内 Task Board；
4. Task 详情中的 primary Session；
5. 手动状态转换与 Activity；
6. 将现有运行中、待确认、失败显示为 Task 的 attention；
7. 暂不改造 ScheduleRunner，先保留 Automation 入口。

这批工作形成完整用户链路，同时控制数据迁移和运行链路风险。下一轮接入 Run 后，再开始改造 Schedule。

## 10. 需要确认的产品决策

进入实现前需要确认四项：

1. Project 是否允许没有用户目录，由 Zora 提供 managed directory；
2. Agent 正常结束后 Task 默认进入 `in_review`，还是保持 `in_progress`；
3. 取消 Task 时是否弹出“同时停止正在执行的 Run”；
4. 自动化默认采用 `new_run` 还是 `continue_task`。

推荐默认值：允许 managed Project；Agent 正常结束进入 in_review；取消 Task 时单独询问停止 Run；自动化默认 new_run。

## 11. 参考对照

### Multica

- Workspace 是顶层租户，Project 是计划与上下文容器，Issue 是任务面板主实体。[Multica 研究稿 §2](../research/multica-task-squad-architecture.md#2-实体关系)
- Issue 七态与 AgentTask 执行态分开，执行态有严格的 claim、运行、终态和重试规则。[Multica 研究稿 §3-4](../research/multica-task-squad-architecture.md#3-issue-生命周期)
- Squad 使用 leader 路由、成员角色、子 Issue 和 stage barrier。[Multica 研究稿 §5](../research/multica-task-squad-architecture.md#5-squad-管理与调度)

### Cindy

- Session 保存 `active / archived / deleted` 可见生命周期，并区分 Project/Dialogue 工作空间。[`apps/desktop/src/main/localDb/schema.ts:39-66`](../../../github_ref/cindy/apps/desktop/src/main/localDb/schema.ts#L39)
- Schedule 定义与 ScheduleRun 分开；Run 保存 running/success/failed/aborted/interrupted/skipped、结果、错误、费用和已读状态。[`packages/maker-scheduler/src/types.ts:166-299`](../../../github_ref/cindy/packages/maker-scheduler/src/types.ts#L166)
- Orca Team 和 Worker 独立建模，Worker 状态为 idle/running/done/error，并通过 sessionId 关联真实上下文。[`apps/desktop/src/main/localDb/schema.ts:246-300`](../../../github_ref/cindy/apps/desktop/src/main/localDb/schema.ts#L246)

Cindy 的经验进一步支持 Task、Run、Conversation、Squad 分层，并表明运行历史和 Worker 恢复需要稳定的持久化身份。
