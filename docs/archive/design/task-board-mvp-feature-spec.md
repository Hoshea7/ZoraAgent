# Zora 任务面板 MVP 与 Feature 方案

## 1. 产品结论

任务面板第一阶段建立在 Zora 现有实体之上：

```text
Project（当前 Workspace）
└── Task
    ├── Primary Conversation（当前 Session，MVP 每个 Task 一个）
    ├── Runs（每次执行、修改、重试）
    ├── Execution Cards（Run 的界面呈现）
    ├── Comments
    ├── Artifacts
    └── Activity
```

MVP 不复制 Multica 的 Workspace、Project、Agent、Squad 全部层级。当前 `WorkspaceMeta` 继续作为数据和目录边界，产品界面按“项目”呈现。Task 是新增的工作管理实体，Conversation 和 Runtime 继续复用 Zora 已有能力。

## 2. Multica 上下文机制的参考结论

Multica 中需要区分三种对象：

- Issue 保存业务目标、状态、负责人和评论。
- AgentTask 保存一次执行记录。
- Session 保存 Agent 可恢复的运行上下文。

Issue 评论支持根评论线程和多级回复。评论可以创建新的 AgentTask，但新 AgentTask 默认按 `(agent_id, issue_id)` 恢复最近可用的 Session。评论线程、AgentTask 和 Session 没有一一对应关系。

因此，Zora 的执行卡片也不应直接等同于 Session。MVP 中：

- Task 详情里的每张 Execution Card 对应一次 Run。
- 同一 Task 的后续修改产生新 Run 和新卡片。
- 新 Run 默认复用 Task 的主 Conversation。
- Session 无法安全恢复时创建新 Session，并向用户显示上下文恢复结果。

## 3. MVP Scope

### 3.1 MVP 目标

验证一个核心假设：用户是否愿意从项目任务面板发起、跟踪、修改和验收 Agent 工作，并减少依赖会话列表管理长期工作。

### 3.2 包含范围

1. 项目级任务面板。
2. 新建、编辑和删除待规划任务。
3. 七个固定业务状态。
4. 拖入待办后自动启动默认 Runtime。
5. 每个 Task 自动创建一个主 Conversation。
6. 每次执行生成独立 Run 和 Execution Card。
7. Task 详情中的过程查看、追加要求和停止执行。
8. Agent 完成后进入审核中。
9. 用户通过验收或要求修改。
10. 执行失败后的阻塞、重试和恢复。
11. 应用重启后的任务、会话和 Run 恢复。
12. 从任务返回其主 Conversation。

### 3.3 暂不包含

- 自定义 Agent
- Squad 和多人协作
- 自动化和周期任务接入
- 多执行者并行
- 一个 Task 下主动创建多个 Conversation
- 子任务和依赖关系
- 自定义状态和自定义字段
- 外部系统导入
- 跨项目任务
- 复杂权限和审批流
- 用量分析

## 4. MVP 核心用户流程

### 步骤 1：进入项目

用户选择一个现有 Project。系统使用当前 Workspace 的名称、目录和会话数据，不要求用户建立新的 Workspace 层级。

项目页面提供“任务”和“会话”两个入口。任务作为项目工作的默认管理视图，会话继续用于自由探索和已有历史。

### 步骤 2：创建任务

用户点击“新建任务”，填写：

- 标题，必填
- 需求描述，可选
- 验收条件，可选

任务保存后进入“待规划”。此时不创建 Session，不启动 Runtime。

### 步骤 3：补充和调整待规划任务

用户可以在待规划列：

- 编辑标题、描述和验收条件
- 调整卡片顺序
- 删除任务
- 将任务拖入待办

待规划表示已经保存的任务草稿。

### 步骤 4：拖入待办并触发执行

用户把任务从待规划拖入待办。界面明确提示“移入待办后将立即启动”。

系统以一个原子操作完成：

1. 将 Task 更新为待办。
2. 检查当前项目目录和默认模型配置。
3. 为 Task 创建主 Conversation，已有主 Conversation 时复用。
4. 创建状态为 queued 的 Run。
5. 将 Run 交给当前 Zora Runtime。

Runtime 真正开始后，Task 进入进行中。排队期间 Task 保持待办，卡片展示“等待启动”。

### 步骤 5：后台执行

用户可以离开任务详情。任务卡片持续显示：

- 当前状态
- 执行中标识
- 最近执行步骤
- 已运行时间
- 是否等待用户
- 最近更新时间

用户点击任务卡片进入详情页。

### 步骤 6：查看执行卡片

任务详情按时间排列 Execution Cards。

首张卡片包含：

- 初始需求
- Run 状态
- Agent 计划和过程摘要
- 工具调用折叠信息
- 结果摘要
- 生成文件
- 停止按钮

Execution Card 对应一次 Run。底层消息仍写入 Task 的主 Conversation。

### 步骤 7：Agent 提交结果

Run 成功结束后：

1. 保存结果摘要和产物引用。
2. 将 Run 标记为 succeeded。
3. 将 Task 移入审核中。
4. 在任务卡片上显示“等待审核”。

Run 成功结束不直接完成 Task。

### 步骤 8：用户审核

用户在审核中执行两种操作：

#### 通过

用户点击“通过并完成”，Task 进入已完成。

#### 要求修改

用户输入修改意见并点击“继续执行”。系统：

1. 保存修改意见。
2. 创建新的 Run 和 Execution Card。
3. 默认恢复主 Conversation。
4. 将 Task 进入进行中。
5. Agent 根据历史上下文和本次修改继续执行。

每轮修改形成一张新的 Execution Card，用户可以回看完整迭代过程。

### 步骤 9：处理失败和阻塞

Run 失败时：

1. Run 进入 failed。
2. Task 进入已阻塞。
3. 卡片显示失败原因和建议动作。

用户可以：

- 重试，优先恢复原 Conversation
- 使用新 Conversation 重试
- 补充信息后继续
- 取消任务

恢复失败或上下文不安全时，系统创建新 Session，并注入 Task 描述、验收条件、历史结果摘要和最近修改意见。

## 5. 状态机

### 5.1 Task 状态

| 状态 | 用户语义 | 是否运行 |
|---|---|---|
| 待规划 | 已保存的任务草稿 | 否 |
| 待办 | 已确认执行，等待 Runtime 启动 | 可能排队 |
| 进行中 | 至少一个 Run 正在执行或等待用户 | 是 |
| 审核中 | Agent 已提交结果 | 否 |
| 已阻塞 | 当前 Run 无法继续 | 否 |
| 已完成 | 用户已经验收 | 否 |
| 已取消 | 用户终止目标 | 否 |

### 5.2 允许的 MVP 转移

```text
待规划 → 待办
待办 → 进行中 | 已阻塞 | 已取消
进行中 → 审核中 | 已阻塞 | 已取消
审核中 → 进行中 | 已完成 | 已取消
已阻塞 → 待办 | 进行中 | 已取消
已完成 → 待规划
```

看板拖拽只允许执行上述转移。需要副作用的转移由 TaskLifecycle 模块统一处理。

### 5.3 Run 状态

```text
queued → running → succeeded
                 ├→ waiting_for_user → running
                 ├→ failed
                 └→ cancelled
```

Task 和 Run 分别维护状态。停止 Run 不自动取消 Task；取消 Task 时需要同时询问是否停止当前 Run。

## 6. 实体设计

### 6.1 Project

MVP 继续使用当前 `WorkspaceMeta`：

```ts
interface WorkspaceMeta {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}
```

界面名称使用 Project，存储和 IPC 继续使用 `workspaceId`。

### 6.2 Task

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
  acceptanceCriteria?: string;
  status: TaskStatus;
  position: string;
  primarySessionId?: string;
  latestRunId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

### 6.3 Run

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
  parentRunId?: string;
  trigger: "initial" | "revision" | "retry";
  instruction: string;
  status: TaskRunStatus;
  resultSummary?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}
```

### 6.4 Comment

```ts
interface TaskComment {
  id: string;
  taskId: string;
  runId?: string;
  author: "user" | "agent" | "system";
  content: string;
  action: "note" | "run_instruction";
  createdAt: string;
}
```

`note` 只保存信息。`run_instruction` 创建新的 Run。

### 6.5 Activity

```ts
interface TaskActivity {
  id: string;
  taskId: string;
  type:
    | "task_created"
    | "task_updated"
    | "status_changed"
    | "run_created"
    | "run_started"
    | "run_finished"
    | "comment_added";
  payload: Record<string, unknown>;
  createdAt: string;
}
```

## 7. 上下文规则

### 7.1 MVP 默认规则

- 一个 Task 只有一个 `primarySessionId`。
- 初始 Run 创建主 Session。
- 修改 Run 和普通重试恢复主 Session。
- 每个 Run 记录实际使用的 `sessionId`。
- Runtime 返回新的 SDK Session ID 时更新 SessionMeta。

### 7.2 新 Session 的条件

- 用户明确选择“使用新上下文重试”。
- Provider 判断原 Session 无法恢复。
- 上下文溢出且压缩无法继续。
- Session 数据损坏。
- Runtime 类型发生变化且无法跨 Runtime 恢复。

### 7.3 新 Session 的上下文注入

新 Session 不复制全部历史消息，注入结构化 Task Brief：

- Task 标题和描述
- 验收条件
- 当前状态
- 已完成工作摘要
- 当前产物
- 最近一次失败或修改意见
- 需要继续处理的内容

## 8. 界面方案

### 8.1 项目任务面板

固定七列：待规划、待办、进行中、审核中、已阻塞、已完成、已取消。

默认只展开前五列，已完成和已取消可折叠。

任务卡片展示：

- 标题
- 状态
- 最近 Run 状态
- 最近执行摘要
- 更新时间
- 审核或阻塞标识

MVP 不展示 Agent 选择器、优先级、自定义标签和子任务进度。

### 8.2 任务详情

页面分为三个区域：

1. Task Brief：标题、描述、验收条件、状态。
2. Execution Timeline：按时间排列 Run 卡片。
3. Composer：添加备注或要求 Agent 继续执行。

Composer 提供两个明确动作：

- 添加备注
- 继续执行

由此避免普通备注意外触发 Runtime。

### 8.3 会话兼容

任务生成的主 Session 仍可以在会话界面打开，但显示所属 Task。任务详情是主要入口，会话界面提供底层消息检查和现有交互能力。

普通会话暂不自动转换为 Task。后续增加“转换为任务”时，建立 Task 并把当前 Session 设置为主 Conversation。

## 9. 核心模块

### TaskLifecycle

唯一负责 Task 状态转移和副作用。

```ts
interface TaskLifecycle {
  transition(input: {
    taskId: string;
    to: TaskStatus;
    revisionInstruction?: string;
  }): Promise<TaskTransitionResult>;
}
```

它内部负责状态校验、Session 创建、Run 创建、Runtime 调度和失败补偿。看板、详情页和未来自动化都使用同一个接口。

### TaskExecution

负责执行一个 Run：

```ts
interface TaskExecution {
  start(runId: string): Promise<void>;
  stop(runId: string): Promise<void>;
  retry(runId: string, mode: "resume" | "fresh"): Promise<TaskRun>;
}
```

内部复用现有 `session-runner.ts`，Task 模块不直接依赖具体 Provider。

### TaskRepository

负责 Task、Run、Comment 和 Activity 的持久化。MVP 可继续使用 Workspace 目录下的 JSON 文件，但写入必须使用原子替换和单任务串行队列。

## 10. 关键产品规则

1. 创建待规划任务不创建 Session。
2. 拖入待办会产生执行副作用，界面必须提前说明。
3. Task 进入进行中以 Runtime 真正启动为准。
4. Run 完成后 Task 进入审核中。
5. 用户验收后 Task 才进入已完成。
6. 修改意见创建新 Run，并默认复用主 Session。
7. 普通备注不触发 Runtime。
8. 一个 Task 同时只允许一个 active Run。
9. 重复拖拽或重复点击使用幂等键，不能创建多个 Run。
10. 应用退出时保留 active Run 状态；重启后无法恢复的 Run 转为 failed，Task 转为已阻塞。
11. 停止 Run 与取消 Task 分开处理。
12. Session 恢复失败时显示提示，并注入 Task Brief 后继续。

## 11. 验收场景

### 场景 A：完整执行

创建待规划任务，拖入待办，Runtime 启动，任务进入进行中，Agent 交付后进入审核中，用户通过后进入已完成。

### 场景 B：修改循环

审核中填写修改意见，系统生成第二张 Execution Card，恢复原 Session，任务进入进行中，第二次交付后重新进入审核中。

### 场景 C：运行失败

执行失败后 Run 显示失败原因，Task 进入已阻塞。用户重试后创建新 Run，原 Run 保留。

### 场景 D：应用重启

任务和历史 Run 可以恢复。运行中的 Run 无法恢复时进入 failed，任务进入已阻塞，用户可以继续重试。

### 场景 E：重复触发

用户快速重复拖拽或点击继续执行，只创建一个 active Run。

## 12. 后续 Feature 扩展

MVP 验证后按以下顺序扩展：

### 阶段 2：多 Conversation

- Task 下显式新建工作线程
- 每个工作线程绑定独立 Session
- 从某次 Run fork Session
- 线程结果汇总到 Task Brief

### 阶段 3：自动化

- 定时创建 Task
- 定时创建 Run
- 状态变化触发后续动作
- 外部来源写入待规划

### 阶段 4：Agent 和 Squad

- 自定义 Agent
- Task 分配 Agent
- Squad leader 路由
- 多 Agent 并行 Run
- 子任务和阶段屏障

### 阶段 5：协作工作台

- 成员负责人
- Inbox
- Mention
- 权限和审批
- 跨项目视图
- 用量和效率分析
