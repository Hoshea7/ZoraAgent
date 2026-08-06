# 产品规则与验收准则

这里记录 Zora 当前版本的产品业务逻辑、交互准则、数据准则、安全准则和测试准则。

它不是“永远不能改变的不变量”。当产品设计演进时，这里的规则也可以被更新、废弃或替换。关键是：每条规则都应该能关联到产品能力、测试 Case 或历史问题。

推荐流转：

```text
发现问题 → 修复问题 → 提炼为产品规则 → 吸收到对应 GUI 剧本或 L1/L2 断言
```

## 当前规则

### RULE-RUNTIME-001 Runtime 共享同一模型解析结果

会话执行前必须在主进程统一解析 Provider、API key、协议和有效模型。Claude 与 Pi Runtime 接收同一份执行目标，只处理各自 SDK 的协议转换和执行。

验收标准：

- 会话未保存模型覆盖值时，两个 Runtime 均使用 Provider 默认模型。
- 会话保存有效模型覆盖值时，两个 Runtime 均使用该模型。
- 已保存的模型覆盖值失效时，两个 Runtime 均回退到当前 Provider 默认模型。
- Provider 配置缺失时不调用任何 Runtime。
- Pi 初始化失败时显示错误并结束当前运行，不自动调用 Claude。
- 协议字段尚未写入的历史 Provider 按 Anthropic Messages 协议执行，保持原有 Claude 调用语义。
- 新建 Provider 必须持久化协议，运行时不得根据 Runtime 类型改写 Provider 协议。
- Provider 预设必须同时确定 Provider 类型、接口协议和默认 Base URL。Runtime 不得根据服务商名称推断协议或改写 Base URL。
- 火山 Agent Plan 的 Anthropic 端点 `/api/plan` 与 OpenAI 端点 `/api/plan/v3` 必须作为独立预设展示。
- 自定义 Provider 必须由用户明确选择 Anthropic Messages 或 OpenAI Chat Completions。
- Claude 只允许选择 Anthropic Messages Provider；Pi 允许选择 Anthropic Messages 和 OpenAI Chat Completions Provider。
- Provider 连接测试必须使用已保存或表单当前选择的协议。
- 模型配置列表必须展示 Provider 图标、模型数量和支持的 Runtime。
- 已知 Provider 使用产品图标；自定义 Provider 先按接口域名匹配已知品牌，无法匹配时使用配置名称的首字符。
- Runtime 标签必须由共享协议能力表生成，不能在设置页单独维护兼容性映射。
- Pi Provider 请求失败时，界面必须显示错误并结束当前运行状态，主进程日志必须包含 Pi 请求阶段和错误原因。
- Runtime 是逐轮执行选择。用户可以在同一会话切换 Runtime，运行中修改只影响下一轮。
- Zora 持久化会话是跨 Runtime 的历史来源。切换 Runtime 后不得丢失前序用户消息和助手回复。
- Pi 的 Write、Edit 和非安全 Bash 调用必须复用 Zora 权限确认流程；Read、Grep、Glob 和安全 Bash 按现有权限规则处理。
- Pi 运行必须支持停止，停止后保留会话历史并允许继续发送。
- Runtime Adapter 必须把 thinking、text 和 tool call 的 start、delta、end 映射为公共流式事件，前端不得按 Runtime 建立独立渲染分支。
- Provider 输出思考或工具调用时，过程区域必须先于最终正文出现；最终快照不得延迟插入分析步骤或重复创建工具步骤。
- 公共流式 reducer 必须按 sessionId、contentIndex 和 toolCallId 关联交错内容块，不能依赖单个全局活动块。

覆盖 Case：`L3-RUNTIME-001`；L1 回归：`tests/unit/shared/provider-presets.test.ts`、`tests/unit/shared/runtime-capabilities.test.ts`、`tests/unit/main/runtime-execution-target.test.ts`、`tests/unit/main/pi-event-mapper.test.ts`、`tests/unit/main/pi-adapter.test.ts`、`tests/unit/renderer/store/chat-stream.test.ts`。

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

### RULE-QA-002 核心用户流程必须有自动化 Electron E2E

Provider、SDK、Runtime、IPC 或聊天渲染链路变更后，必须通过 Playwright 从 Electron 用户界面完成核心流程验证。

验收标准：

- 测试通过可见界面选择 Runtime、输入消息和观察结果，不直接调用 renderer store、IPC handler 或 RuntimeAdapter。
- 稳定 E2E 使用本地协议服务器替代外部模型网络，Electron、Pi Agent、文件工具、会话、IPC 和消息渲染使用真实实现。
- 真实 Provider E2E 使用隔离 HOME，并允许明确指定 Provider。
- 真实 Provider E2E 结束后自动删除包含 API key 的隔离 HOME。
- Computer Use 继续承担视觉、文案、交互感受和探索式巡检。

覆盖 Case：`tests/e2e/pi-runtime.spec.ts`、`tests/e2e/pi-runtime.live.spec.ts`。
