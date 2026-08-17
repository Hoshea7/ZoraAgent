# Multica 任务生命周期与 Squad 架构研究

> 研究范围：`/Users/bytedance/Desktop/03-code/github_ref/multica`
>
> 研究方法：仅基于该仓库源码、数据库迁移和仓库内一手文档。行号对应本次调研时的本地版本。

## 1. 结论

Multica 没有把任务实现成一个单一状态机。系统实际维护三类相互关联、各自独立的状态：

1. **Issue 状态**表示用户看到的工作生命周期，取值为 `backlog / todo / in_progress / in_review / done / blocked / cancelled`。Issue 是任务面板、项目计划、父子任务和负责人分配的核心实体。[`packages/core/types/issue.ts:4-15`](../../../github_ref/multica/packages/core/types/issue.ts#L4)
2. **AgentTask 状态**表示一次执行尝试的生命周期，至少包括 `queued / dispatched / waiting_local_directory / running / completed / failed / cancelled`，数据库的新版本还存在延迟重试用的 `deferred`。它承担队列、并发控制、重试、恢复和执行日志，不等同于 Issue 状态。[`packages/core/types/agent.ts:268-305`](../../../github_ref/multica/packages/core/types/agent.ts#L268) [`server/pkg/db/queries/agent.sql:417-459`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L417)
3. **ChatSession 状态**只有 `active / archived`，用于保存人与 Agent 的持续会话；一次聊天发送也会创建 AgentTask，但可以不关联 Issue。ChatSession 可以选择一个 Project 作为持久上下文。[`server/migrations/033_chat.up.sql:3-36`](../../../github_ref/multica/server/migrations/033_chat.up.sql#L3) [`packages/core/types/chat.ts:72-95`](../../../github_ref/multica/packages/core/types/chat.ts#L72)

Squad 不是并行执行器。它是一个可被分配和提及的协作实体，包含 leader、成员、角色和指令。Squad 收到 Issue 后，平台把执行任务派给 leader；leader 通过评论中的 `@mention` 或创建子 Issue 继续委派。平台负责触发、去重、父子阶段屏障和再次唤醒，leader 负责判断工作如何拆分、何时推进下一阶段，以及何时将父 Issue 提交到 `in_review`。[`server/internal/service/issue_trigger.go:117-163`](../../../github_ref/multica/server/internal/service/issue_trigger.go#L117) [`server/internal/handler/squad_briefing.go:23-71`](../../../github_ref/multica/server/internal/handler/squad_briefing.go#L23)

对任务面板而言，最重要的设计原则是：**业务任务、执行尝试、会话应作为独立实体建模，再用显式关联组织成同一工作上下文。** 如果把执行状态直接写成任务状态，重试、并行 Agent、排队、失败回滚和人工审核会互相冲突。

## 2. 实体关系

### 2.1 Workspace 是租户与数据边界

Workspace 是顶层租户。Member、Agent、Issue 都直接包含 `workspace_id`；Member 通过 `(workspace_id, user_id)` 唯一约束加入 Workspace，并有 `owner / admin / member` 角色。[`server/migrations/001_init.up.sql:14-49`](../../../github_ref/multica/server/migrations/001_init.up.sql#L14)

服务端在查询和写入中反复使用 `workspace_id` 作为租户保护。例如 Issue 的状态更新同时匹配 `id` 与 `workspace_id`。[`server/pkg/db/queries/issue.sql:116-122`](../../../github_ref/multica/server/pkg/db/queries/issue.sql#L116)

### 2.2 Project 是 Workspace 下的计划与上下文容器

Project 直接属于 Workspace，拥有自己的 `planned / in_progress / paused / completed / cancelled` 状态、负责人和日期。Issue 可选关联 Project，删除 Project 时 Issue 的引用被置空。[`server/migrations/034_projects.up.sql:1-20`](../../../github_ref/multica/server/migrations/034_projects.up.sql#L1) [`packages/core/types/project.ts:1-24`](../../../github_ref/multica/packages/core/types/project.ts#L1)

Project 同时承载外部资源上下文，例如 GitHub 仓库和本地目录；这些资源决定 Agent 在哪里执行，而不只是前端分组标签。[`packages/core/types/project.ts:59-95`](../../../github_ref/multica/packages/core/types/project.ts#L59)

ChatSession 可选关联一个 Project。该关联采用软引用：项目删除时保留会话历史，只清空 `project_id`；Agent claim 时重新校验 Workspace 归属，再注入项目上下文。[`server/migrations/214_chat_session_project.up.sql:1-14`](../../../github_ref/multica/server/migrations/214_chat_session_project.up.sql#L1) [`server/pkg/db/queries/chat.sql:6-12`](../../../github_ref/multica/server/pkg/db/queries/chat.sql#L6)

### 2.3 Issue 是工作管理的主实体

Issue 直接属于 Workspace，可选属于 Project，并包含：

- 用户生命周期状态和优先级；
- `member / agent / squad` 三类负责人；
- `member / agent` 等创建者归属；
- 父 Issue、位置、开始日期、截止日期；
- 标签、依赖关系、评论、活动日志、metadata 和自定义 properties；
- 子 Issue 的 stage 序号。

基础表结构见 [`server/migrations/001_init.up.sql:51-107`](../../../github_ref/multica/server/migrations/001_init.up.sql#L51)，当前客户端实体见 [`packages/core/types/issue.ts:26-69`](../../../github_ref/multica/packages/core/types/issue.ts#L26)。

Issue 的 `parent_issue_id` 表达分解关系。`stage` 在同一父 Issue 的子项中定义有序屏障组；顶层 Issue 的 stage 不生效。[`server/migrations/123_issue_stage.up.sql:1-15`](../../../github_ref/multica/server/migrations/123_issue_stage.up.sql#L1)

### 2.4 ChatSession 与 Issue 没有直接从属关系

ChatSession 属于 Workspace，固定关联一个 Agent 和创建者，可选关联 Project。AgentTask 可以指向 Issue，也可以指向 ChatSession；聊天任务因此不要求存在 Issue。[`server/migrations/033_chat.up.sql:3-36`](../../../github_ref/multica/server/migrations/033_chat.up.sql#L3)

这个关系意味着 Multica 的普通聊天与任务协作是两条入口：

- ChatSession 组织持续对话与上下文；
- Issue 组织可追踪的工作、负责人、状态、评论和交付；
- AgentTask 统一承接两类入口的实际执行。

### 2.5 Squad 是 Workspace 下的可分配协作实体

Squad 属于 Workspace，包含 leader Agent、creator、描述；后续版本增加 instructions、头像和归档字段。SquadMember 通过多态的 `member_type + member_id` 支持 Agent 和人类成员，并保存自由文本 role。Issue 的 `assignee_type` 扩展为 `member / agent / squad`。[`server/migrations/084_squad.up.sql:1-33`](../../../github_ref/multica/server/migrations/084_squad.up.sql#L1) [`packages/core/types/squad.ts:1-35`](../../../github_ref/multica/packages/core/types/squad.ts#L1)

关系可以概括为：

```text
Workspace
├── Members
├── Agents ───────────────┐
├── Squads                │
│   ├── leader: Agent     │
│   └── members: Agent | Member
├── Projects
│   ├── Resources
│   ├── Issues (optional project_id)
│   └── ChatSessions (optional soft project_id)
├── Issues
│   ├── parent/children + stage
│   ├── assignee: Member | Agent | Squad
│   ├── comments/activity/labels/properties
│   └── AgentTasks ───────┤
└── ChatSessions          │
    ├── Messages          │
    └── AgentTasks ───────┘
```

## 3. Issue 生命周期

### 3.1 状态集合

Issue 的七个状态是：

| 状态 | 主要语义 |
|---|---|
| `backlog` | 暂存，分配给 Agent 或 Squad 时不启动执行 |
| `todo` | 待执行，可由从 backlog 激活触发执行 |
| `in_progress` | Agent 或 Squad leader 已开始处理 |
| `in_review` | Agent 已交付，等待人工或集成确认 |
| `done` | 工作完成 |
| `blocked` | 当前存在阻塞 |
| `cancelled` | 用户终止该 Issue 的业务生命周期 |

状态集合在数据库约束和客户端类型中保持一致。[`server/migrations/001_init.up.sql:52-60`](../../../github_ref/multica/server/migrations/001_init.up.sql#L52) [`packages/core/types/issue.ts:4-11`](../../../github_ref/multica/packages/core/types/issue.ts#L4)

### 3.2 它不是严格的转移矩阵

服务端 `UpdateIssue` 校验目标状态属于合法枚举，但没有检查“当前状态到目标状态”的固定转移表。因此，Issue 状态属于开放式工作流状态，权限、Agent 指令和副作用规则决定常规路径；数据库没有强制 `todo → in_progress → in_review → done` 的单向流转。[`server/internal/handler/issue.go:2682-2763`](../../../github_ref/multica/server/internal/handler/issue.go#L2682)

常规 Agent 路径由运行时指令约束：Ownership turn 开始前将 Issue 设为 `in_progress`，普通 Agent 交付后设为 `in_review`，阻塞时设为 `blocked`；Squad leader 首次只推进到 `in_progress`，后续确认总体目标完成后才推进到 `in_review`。[`server/internal/daemon/execenv/runtime_config_sections.go:529-562`](../../../github_ref/multica/server/internal/daemon/execenv/runtime_config_sections.go#L529)

### 3.3 状态写入具有执行副作用

Issue 写入是否启动一次 AgentTask，由统一的 `WillEnqueueRun` 判定：

- 新建 Issue 或更换负责人时，只要负责人是可运行的 Agent/Squad，且 Issue 不在 `backlog`，便尝试启动；
- 已分配的 Issue 从 `backlog` 进入除 `done/cancelled` 外的状态时，尝试启动；
- Squad 实际执行者解析为 leader Agent；
- 状态触发会检查 self-loop 和已有 pending task，避免重复执行；
- 指派触发与评论触发是不同判定路径，评论可以在任意 Issue 状态触发。

源码见 [`server/internal/service/issue_trigger.go:64-165`](../../../github_ref/multica/server/internal/service/issue_trigger.go#L64)。写入接口与预览接口复用同一判定，前端可以在提交前解释“这次修改会启动谁”。[`server/internal/handler/issue.go:2953-2979`](../../../github_ref/multica/server/internal/handler/issue.go#L2953)

`UpdateIssueRequest` 还提供 `suppress_run` 与 `handoff_note`：前者允许修改负责人或状态但暂不启动，后者只在本次写入确实启动执行时注入首轮上下文。这说明“业务状态修改”和“立即执行”在产品上允许分离。[`server/internal/handler/issue.go:2700-2710`](../../../github_ref/multica/server/internal/handler/issue.go#L2700)

### 3.4 终止 Issue 不等于停止执行

将 Issue 改为 `cancelled` 或 `done` 不会隐式取消正在运行的 AgentTask。只有删除 Issue 才会批量取消其执行；用户要停止运行，需要取消具体 Task。这避免状态编辑意外终止并行的提及任务或其他 Agent 的工作。[`server/internal/handler/issue.go:2958-2969`](../../../github_ref/multica/server/internal/handler/issue.go#L2958) [`server/pkg/db/queries/agent.sql:462-471`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L462)

### 3.5 失败后的业务状态回滚

执行失败后，系统先尝试自动重试。没有重试且同一 Issue 已无其他 active task 时，如果 Issue 仍是 `in_progress`，服务端将它回滚到 `todo`，并广播 `issue:updated`，防止任务面板长期停留在进行中。[`server/internal/service/task.go:4250-4318`](../../../github_ref/multica/server/internal/service/task.go#L4250)

### 3.6 父子任务与 stage 屏障

子 Issue 从非终态进入 `done` 或 `cancelled` 后，系统判断是否关闭了当前 stage：

- 同 stage 的所有子 Issue 都进入终态，屏障才关闭；
- 未设置 stage 的全部兄弟 Issue 被视为一个隐式 stage；
- 父 Issue 为 `done / cancelled / backlog` 时不唤醒；
- 父负责人是人类时不自动触发；
- 父负责人是 Agent 或 Squad 时，系统写入一条父 Issue 系统评论并显式创建一次执行；Squad 只唤醒 leader，由 leader 决定下一步。

主要规则见 [`server/internal/handler/issue_child_done.go:16-67`](../../../github_ref/multica/server/internal/handler/issue_child_done.go#L16) 和 [`server/internal/handler/issue_child_done.go:536-585`](../../../github_ref/multica/server/internal/handler/issue_child_done.go#L536)。

系统只知道当前已创建的 stages，无法判断工作流是否真正结束。因此最后一个现有 stage 完成后，leader 需要决定创建下一 stage，或汇总结果并将父 Issue 设为 `in_review`。[`server/internal/handler/issue_child_done.go:436-459`](../../../github_ref/multica/server/internal/handler/issue_child_done.go#L436)

## 4. AgentTask 执行生命周期

### 4.1 状态与主路径

执行主路径为：

```text
deferred ──到期──> queued ──claim──> dispatched
                                      ├──> waiting_local_directory ──取得锁──┐
                                      └───────────────────────────────────────> running
                                                                               ├──> completed
                                                                               ├──> failed ──可重试──> deferred | queued
                                                                               └──> cancelled
```

- `queued → dispatched` 由原子 claim 完成，使用 `FOR UPDATE SKIP LOCKED`，按 priority、created_at、id 排序。[`server/pkg/db/queries/agent.sql:532-570`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L532)
- `dispatched / waiting_local_directory → running` 使用条件更新，防止从终态重新启动。[`server/pkg/db/queries/agent.sql:674-704`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L674)
- 只有 `running` 可以完成为 `completed`。[`server/pkg/db/queries/agent.sql:706-726`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L706)
- `dispatched / running / waiting_local_directory` 可以失败。[`server/pkg/db/queries/agent.sql:919-946`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L919)
- 所有活跃状态和 `deferred` 可以取消。[`server/pkg/db/queries/agent.sql:1090-1094`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L1090)

与 Issue 相比，AgentTask 的状态转移由数据库条件严格保护。

### 4.2 并发与串行规则

Claim 对同一 Agent、同一工作上下文实行串行：

- 同一 `(agent, issue)` 不能同时有多个 dispatched/running/waiting task；
- ChatTask 通过 `chat_session_id` 串行；
- 不同 Agent 可以在同一 Issue 上并行工作；
- 使用 `FOR UPDATE SKIP LOCKED` 支持多个 daemon 并发领取。

规则和 SQL 位于 [`server/pkg/db/queries/agent.sql:532-568`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L532)。

### 4.3 可靠性机制

系统对执行生命周期增加了多层恢复：

- claim 构建失败可将同一 claim generation 退回 `queued`；[`server/pkg/db/queries/agent.sql:597-613`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L597)
- daemon 重启时将原进程持有的执行标为失败，再进入统一重试与 Issue 回滚流程；[`server/internal/handler/task_lifecycle.go:17-42`](../../../github_ref/multica/server/internal/handler/task_lifecycle.go#L17)
- 启动准备阶段使用短 lease；运行阶段结合 runtime heartbeat 判断存活；[`server/pkg/db/queries/agent.sql:988-1045`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L988)
- 队列任务存在 TTL 清理；[`server/pkg/db/queries/agent.sql:1047-1088`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L1047)
- 自动重试保存 attempt、parent/retry lineage、session/workdir 等信息，并可用 `deferred + fire_at` 实现退避。[`server/pkg/db/queries/agent.sql:400-459`](../../../github_ref/multica/server/pkg/db/queries/agent.sql#L400)

### 4.4 Task 与 Issue 的职责边界

AgentTask 的完成不会自动把 Issue 设为 `done`。普通 Agent 需要显式把 Issue 推进到 `in_review`，`done` 通常留给人工审核或 PR merge 等集成。失败路径是主要的服务端主动 Issue 状态写入，会在没有其他执行时将 `in_progress` 回滚为 `todo`。[`server/internal/service/builtin_skills/multica-working-on-issues/SKILL.md:177-203`](../../../github_ref/multica/server/internal/service/builtin_skills/multica-working-on-issues/SKILL.md#L177)

## 5. Squad 管理与调度

### 5.1 创建、权限与成员管理

任意 Workspace Member 可创建 Squad，并成为 creator。创建时必须选择同 Workspace 的 leader Agent，系统自动将 leader 加入成员表并赋予 `leader` role。[`server/internal/handler/squad.go:225-307`](../../../github_ref/multica/server/internal/handler/squad.go#L225)

Squad 更新和成员管理由 Workspace 管理员或 Squad creator 控制。更换 leader 时，新 leader 自动加入成员列表；不能直接移除当前 leader，需要先更换 leader。[`server/internal/handler/squad.go:337-447`](../../../github_ref/multica/server/internal/handler/squad.go#L337) [`server/internal/handler/squad.go:837-870`](../../../github_ref/multica/server/internal/handler/squad.go#L837)

新增成员时校验成员属于同 Workspace，并对私有 Agent 执行可访问性检查。Squad role 是字符串，不是固定权限枚举，主要给 leader 进行任务匹配和提示。[`server/internal/handler/squad.go:748-821`](../../../github_ref/multica/server/internal/handler/squad.go#L748)

### 5.2 归档策略

删除 Squad 实际执行软归档。归档前，系统把所有分配给该 Squad 的 Issue 转移给 leader Agent，同时把指向 Squad 的自动化也转移给 leader，保持后续执行可用。[`server/internal/handler/squad.go:481-538`](../../../github_ref/multica/server/internal/handler/squad.go#L481) [`server/pkg/db/queries/squad.sql:118-134`](../../../github_ref/multica/server/pkg/db/queries/squad.sql#L118)

### 5.3 Squad 的执行入口

Issue 分配给 Squad 时，`WillEnqueueRun` 将实际 Agent 解析为 Squad leader，并检查 leader readiness、访问权限和 pending dedup。[`server/internal/service/issue_trigger.go:136-163`](../../../github_ref/multica/server/internal/service/issue_trigger.go#L136)

AgentTask 保存 `squad_id`，用于 claim 时确定应该注入哪一个 Squad 的 Operating Protocol、Roster 和 Instructions。它刻意不建立 Squad 外键，避免热队列表与 Squad 维护发生跨表锁；找不到 Squad 时跳过 briefing。[`server/migrations/127_task_squad_id.up.sql:1-24`](../../../github_ref/multica/server/migrations/127_task_squad_id.up.sql#L1)

### 5.4 Leader 协调协议

Squad leader 的系统协议要求：

- 读取 Issue 和验收信息；
- 按成员的 skills 与 role 选择执行者；
- 用带类型和 UUID 的 mention 链接委派；
- 每次被触发后记录 `action / no_action / failed` 活动；
- 委派完成后停止，等待成员更新或 stage 完成后再次唤醒；
- 每次唤醒重新判断委派、升级或闭环。

协议源码见 [`server/internal/handler/squad_briefing.go:23-71`](../../../github_ref/multica/server/internal/handler/squad_briefing.go#L23)。

当 Issue 的 assignee 就是该 Squad 时，leader 获得父 Issue 状态管理权：首次进入 `in_progress`，成员工作期间保持该状态，确认总体目标达成后进入 `in_review`，`done` 留给人类审核或集成。如果 Squad 只是被提及，leader 不得修改该 Issue 状态。[`server/internal/handler/squad_briefing.go:73-105`](../../../github_ref/multica/server/internal/handler/squad_briefing.go#L73)

### 5.5 委派方式与重复执行控制

Leader 有两种主要委派方式：

1. 在父 Issue 评论中 @mention 成员；
2. 创建 `todo` 子 Issue 并分配给 Agent。

二者都会触发执行，因此同一工作只能选择一种，否则成员会收到两个并行 Task。该约束目前通过 leader protocol 明确，而不是通过通用数据库约束自动识别“相同工作”。[`server/internal/handler/squad_briefing.go:107-134`](../../../github_ref/multica/server/internal/handler/squad_briefing.go#L107)

### 5.6 Squad 运行状态

Squad 详情页的成员状态由服务端综合 Agent archive、runtime 和 active task 得出：

- archived 优先；
- 有 dispatched/running/waiting task 为 working；
- runtime online 且无活跃任务为 idle；
- offline 但五分钟内有心跳为 unstable；
- 其余为 offline。

规则见 [`server/internal/handler/squad.go:586-629`](../../../github_ref/multica/server/internal/handler/squad.go#L586)。状态接口还返回每个 Agent 当前执行的 Issue 摘要和 last_active_at；人类成员没有实时 presence。[`server/internal/handler/squad.go:632-745`](../../../github_ref/multica/server/internal/handler/squad.go#L632)

## 6. 后端与前端任务面板交互

### 6.1 IssueSurface 是统一任务视图内核

前端没有为 Workspace、Project、My Issues 分别实现不同看板。`IssueSurface` 接收 scope、可用模式、创建默认值和 surfaceKey，由 controller 统一提供查询、筛选、状态分页、工作中的 Agent、创建、移动和批量操作。[`packages/views/issues/surface/issue-surface.tsx:48-131`](../../../github_ref/multica/packages/views/issues/surface/issue-surface.tsx#L48)

同一 surface 支持：

- board；
- list；
- table；
- gantt；
- swimlane。

视图分派与共享 controller 见 [`packages/views/issues/surface/issue-surface.tsx:243-309`](../../../github_ref/multica/packages/views/issues/surface/issue-surface.tsx#L243)。Project Detail 也直接嵌入同一个 IssueSurface，通过 project scope 收窄数据，而不是另建 Project Task 模型。

Workspace 切换和 scope 切换会按 `workspace + scope` 重挂载 surface，避免前一个数据窗口的缓存短暂显示为新 Workspace/Project 的内容。[`packages/views/issues/surface/issue-surface.tsx:62-108`](../../../github_ref/multica/packages/views/issues/surface/issue-surface.tsx#L62)

### 6.2 看板分组与拖拽

Board 支持按 status、assignee 或 select property 分组；assignee 分组原生包含 member、agent、squad 和未分配项。[`packages/views/issues/components/board-view.tsx:72-155`](../../../github_ref/multica/packages/views/issues/components/board-view.tsx#L72)

拖拽有两类写入：

- 跨状态列修改 `status`；
- 跨负责人列修改 `assignee_type / assignee_id`；
- 同列或跨列排序发送 `before_id / after_id` 的 move intent，由服务端确定最终 position；
- property 分组使用独立 property mutation。

拖拽目标计算见 [`packages/views/issues/utils/drag-utils.ts:35-94`](../../../github_ref/multica/packages/views/issues/utils/drag-utils.ts#L35)，落点处理见 [`packages/views/issues/components/board-view.tsx:485-601`](../../../github_ref/multica/packages/views/issues/components/board-view.tsx#L485)。

由于状态或负责人修改可能启动 AgentTask，UI 的一次拖列动作同时可能是工作流转移和执行触发。后端的 trigger preview、`suppress_run` 和 `handoff_note` 用于控制这类副作用。

### 6.3 乐观更新与回滚

`useUpdateIssue` 在同一事件循环内更新 TanStack Query 缓存，避免 DnD 结束后卡片先回原位。请求失败时恢复先前的 detail、list 和 children 缓存；成功后使用服务端返回的单个 Issue 做精确 reconcile，避免整列刷新闪烁。[`packages/core/issues/mutations.ts:231-357`](../../../github_ref/multica/packages/core/issues/mutations.ts#L231)

跨多个工作面板的数据一致性由 `IssueCacheCoordinator` 统一处理。它判断 Issue 在每个已加载 scope 中应该 patch、rebucket、remove 或标记 stale；本地 mutation 与 WebSocket 更新共用同一规则。[`packages/core/issues/cache-coordinator.ts:39-79`](../../../github_ref/multica/packages/core/issues/cache-coordinator.ts#L39)

### 6.4 实时同步

服务端 Issue 更新后发布完整 Issue、前一状态以及 `status_changed / assignee_changed / project_changed` 等维度。[`server/internal/handler/issue.go:2910-2951`](../../../github_ref/multica/server/internal/handler/issue.go#L2910)

前端 WebSocket 收到 `issue:updated` 后，将这些维度传给同一缓存协调器，并同步 Inbox 的 Issue 状态。这样其他标签页、其他用户或 Agent 引起的流转会立即更新任务面板。[`packages/core/realtime/use-realtime-sync.ts:911-931`](../../../github_ref/multica/packages/core/realtime/use-realtime-sync.ts#L911)

Task 事件与 Issue 事件分开。Task snapshot 和 task events 用于运行状态、执行日志和 Agent working 指示；Issue updated 用于看板卡片位置和业务状态。这种事件拆分对应两套生命周期。

## 7. 可迁移的架构要点

以下内容是从 Multica 源码中抽取的可迁移设计，不包含对 Zora 当前实现的判断。

### 7.1 优先迁移的最小内核

1. **Task/Issue 主实体**：workspace/project 范围、标题、描述、七态生命周期、优先级、负责人、父子关系、position、日期和审计时间。
2. **Run/ExecutionAttempt 子实体**：每次 Agent 执行单独建记录，保存 queued/running/terminal 状态、attempt、错误、result、session/workdir、触发来源和 lineage。
3. **Task 与 Conversation 的显式关联**：Task 可以关联多个会话或运行；会话继续承担消息历史，不承担业务生命周期。
4. **统一触发判定**：把“本次任务字段修改是否启动执行、启动谁”做成可预览、可复用的纯服务规则；写入接口与 UI 预览复用。
5. **实时事件**：TaskUpdated 与 RunUpdated 分开，事件带 changed dimensions 和前值，使多个任务面板能做精确缓存更新。

### 7.2 Squad 适合第二阶段接入

Squad 依赖稳定的 Task、Run、Agent readiness、mention trigger、父子任务和实时事件。先引入 leader + roster + instructions 的静态配置价值有限；完整价值来自：

- Task assignee 支持 Agent 或 Squad；
- Squad assignment 解析到 leader Run；
- leader claim 时注入 squad protocol/roster/instructions；
- leader 委派产生独立成员 Run 或子 Task；
- 成员结果通过评论或 stage barrier 再次唤醒 leader；
- Task 详情展示 squad activity 和成员 working 状态。

### 7.3 不宜直接复制的实现

- Issue 状态没有数据库级转移矩阵。若 Zora 需要更强的流程约束，应显式设计 transition policy，而不能只复制七个枚举。
- Squad 的“同一工作不得同时 mention 和创建子 Issue”依赖 prompt 规则，平台无法识别语义重复。需要高可靠性时，应增加 delegation record 或 idempotency key。
- ChatSession 只支持一个 `project_id`，且与 Issue 没有直接关联。围绕 Task 聚合多个会话时，需要独立的 task-conversation 关联表。
- `member_type + member_id`、`assignee_type + assignee_id` 是应用层多态引用，数据库无法通过外键验证目标。如果 Zora 当前是单用户本地应用，可以先使用更窄的 owner/agent 模型，待协作需求明确后扩展。

## 8. 对整体架构研究的输入

结合本研究，后续设计 Zora 任务面板时应明确回答四个问题：

1. Zora 的 Workspace 和 Project 是否合并为同一实体；若合并，任务、会话、技能、知识和执行目录都以该实体作为边界。
2. 一个 Task 是否可以关联多个 Conversation；如果可以，需要 task-conversation 关联实体，以及主会话、辅助会话、Run 来源等角色字段。
3. Task 状态由用户、Agent、自动化分别拥有哪些转移权限；失败、取消、重试与人工审核如何影响业务状态。
4. 自动化创建的是 Task、Run，还是只向现有 Task 添加触发；这决定自动化与任务生命周期能否统一进入同一面板。

Multica 给出的核心答案是：Project/Workspace 管上下文，Issue 管工作，ChatSession 管对话，AgentTask 管一次执行，Squad 管分工。Zora 可以调整层级名称，但这四类职责需要保持分离。
