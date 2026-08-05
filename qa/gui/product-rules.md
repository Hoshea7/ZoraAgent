# 产品规则与验收准则

这里记录 Zora 当前版本的产品业务逻辑、交互准则、数据准则、安全准则和测试准则。

它不是“永远不能改变的不变量”。当产品设计演进时，这里的规则也可以被更新、废弃或替换。关键是：每条规则都应该能关联到产品能力、测试 Case 或历史问题。

推荐流转：

```text
发现问题 → 修复问题 → 提炼为产品规则 → 吸收到对应 GUI 剧本或 L1/L2 断言
```

## 当前规则

### RULE-TASK-001 手动任务必须按工作区持久化并可见

用户必须能从侧边栏进入任务面板，在当前工作区新建、查看和删除手动任务；应用完全退出并重启后，未删除的任务仍然存在。

验收标准：

- 展开和折叠侧边栏都提供“任务”入口。
- 新建任务后列表立即出现，详情展示标题、描述和只读 `todo` 状态。
- 删除任务后列表立即移除。
- 不同工作区的任务相互隔离。
- 任务持久化到 `.zora/workspaces/<workspaceId>/tasks/tasks.json`。
- 对话、定时任务和设置入口不受影响。

覆盖 Case：`L3-TASK-001`；L1 回归：`tests/unit/main/task-store.test.ts`、`tests/unit/renderer/components/TaskPanel.test.tsx`；L2 回归：`tests/integration/task-lifecycle.test.ts`。

### RULE-INIT-001 全新环境必须进入唤醒

全新或无有效 Zora 档案的环境必须进入唤醒流程，不能直接进入旧用户主界面。

验收标准：

- 隔离 HOME 下首次启动后，界面进入 Provider/唤醒引导。
- 不读取开发者真实 `~/.zora`。
- 不直接恢复真实用户历史 session。

覆盖 Case：`L3-INIT-001`

### RULE-PROV-001 L3 GUI 报告禁止泄露 API key

L3 GUI 测试可以复制本机默认 Provider 到隔离 HOME，但报告禁止记录 API key。

验收标准：

- 报告只出现 Provider 名称、模型和 baseUrl。
- API key 只允许短暂停留在本次隔离 `home/.zora/providers.json`。
- 测试结束后执行 `bun run test:gui:clean` 清理测试 HOME。

覆盖 Case：`L3-INIT-001`

### RULE-AWAK-001 唤醒完成后必须生成 Zora 档案

唤醒完成后必须生成 `SOUL.md`、`IDENTITY.md`、`USER.md`，并能进入主界面。

验收标准：

- 文件位于隔离 `home/.zora/zoras/default/`。
- 主界面可继续日常对话。
- 后续对话能读取并使用用户画像。

覆盖 Case：`L3-INIT-001`

### RULE-MEM-001 缺少 MEMORY.md 不应造成用户可见错误

缺少 `MEMORY.md` 不应造成用户可见错误，也不应阻断日常对话。

验收标准：

- Agent 可优雅跳过缺失文件，或初始化空文件。
- 最终回复不暴露工具错误。
- 日常对话仍可读取 `USER.md` 和 `SOUL.md` 中的有效画像。

覆盖 Case：`L3-INIT-001`

状态：待修复或待产品确认。

### RULE-MEM-002 记忆关闭后不得污染新会话上下文

用户在记忆设置中关闭记忆后，新会话不得注入 `USER.md`、`MEMORY.md` 或近期 daily log，也不得继续排队处理新的记忆提取任务。

验收标准：

- 关闭记忆后，Provider 请求中的 `zora_dynamic_context` 仍保留当前时间、工作区等运行上下文。
- 关闭记忆后，`zora_dynamic_context` 不包含长期记忆文件内容或近期记忆日志。
- 关闭记忆后，手动记忆处理入口不再出现，后台不会新增待处理记忆任务。
- 重新开启记忆后，已有记忆文件保留并继续按当前记忆模式生效。

覆盖 Case：待补充 L3 设置页巡检。

### RULE-CTX-001 大 payload 不得污染 Provider 请求

超大工具结果或 base64 payload 不得原样进入 Provider 请求上下文。

验收标准：

- Provider payload 保持合理大小。
- PDF、图片等大内容被摘要、截断或引用化。
- 历史 PDF 422 问题不能回归。

覆盖 Case：`L2-REG-PDF-422`

### RULE-FORK-001 Fork 后的会话必须可继续 Fork

从已有会话 Fork 出的新会话，其历史消息与 SDK transcript 的消息 UUID 必须保持一致，用户可以继续从任意可 Fork 的历史助手消息再次 Fork。

验收标准：

- Fork 会话继承的助手消息使用当前 forked SDK session 中的 UUID。
- 从 Fork 会话再次 Fork 时，不出现 `Message ... not found in session ...`。
- 兼容历史错位数据时，不改变用户可见消息内容和附件引用。

覆盖 Case：待补充 L3 分支巡检；L1 回归：`tests/unit/main/session-fork.test.ts`。

### RULE-ARCH-001 已归档会话必须支持批量整理

已归档会话列表应支持多选、全选、批量恢复和批量永久删除，避免用户需要逐条处理历史归档。

验收标准：

- 有归档会话时，列表提供全选入口和单条选择入口。
- 选中一条或多条后，界面显示已选择数量，并提供批量恢复、批量删除和取消选择。
- 批量恢复成功后，已恢复会话从归档列表移除，并出现在对应工作区会话列表中。
- 批量删除必须经过二次确认，确认文案说明会删除的内容和不会删除项目目录。
- 批量操作中不得重复触发同一条会话的恢复或删除。

覆盖 Case：待补充 L3 设置页巡检；L1 回归：`tests/unit/renderer/components/ArchivedSessionsSettings.test.tsx`。

### RULE-MD-001 Markdown 有序列表编号不得被裁切

Agent 回复中的 Markdown 有序列表必须完整展示编号，尤其是 `10.` 及以上的两位数编号，不能因消息块渲染优化或缩进不足只显示末位数字。

验收标准：

- 有序列表使用内部缩进为 marker 预留空间。
- `10.`、`11.`、`12.` 等两位数编号完整可见。
- 列表正文与普通段落保持稳定对齐，不因编号位数变化产生明显跳动。

覆盖 Case：待补充 L3 对话渲染巡检；L1 回归：`tests/unit/renderer/components/MarkdownMessage.test.tsx`。

### RULE-MD-002 Markdown 普通表格不得被横向裁切

Agent 回复中的 4-5 列普通 Markdown 表格应优先在消息宽度内稳定换行，不能因为表头不换行或单元格撑宽导致内容被横向渐隐层遮挡、列内容互相挤压。

验收标准：

- 普通表格使用固定表格布局，长中文、英文路径或 API 名称在单元格内换行。
- 普通表格表头允许换行，不能用不换行内容撑开整张表。
- 只有列数很多或总内容明显过宽的表格进入宽表横向滚动模式。
- 滚动模式下内容仍需有清晰边界，不能出现正文被外层消息容器裁切。

覆盖 Case：待补充 L3 对话渲染巡检；L1 回归：`tests/unit/renderer/components/MarkdownMessage.test.tsx`。

### RULE-QA-001 L3 GUI 巡检必须清理测试 HOME

L3 GUI 巡检必须使用隔离 HOME，结束后默认清理测试 HOME，只保留脱敏报告、截图和日志。

验收标准：

- 运行 `bun run test:gui:clean` 后，`tests/.artifacts/gui/runs/*/home` 不存在。
- 项目根目录不生成 `MEMORY.md`、`USER.md`、`SOUL.md` 或 `memory/`。
- 若需要保留现场，必须先明确告诉用户并在报告中标注。
