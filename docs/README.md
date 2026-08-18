# 文档入口

当前实现以根目录 `README.md`、`src/`、`tests/` 和项目规则文件为准。本索引标注每份文档的状态：当前合同、待实施方案、架构决策、时间点调研、已归档。

## 当前合同（描述 main 上已实现的行为）

- [`subtask-delegation.md`](./subtask-delegation.md)：子任务的创建、权限、并发、等待和会话生命周期合同。
- [`vision-assistant-design.md`](./vision-assistant-design.md)：视觉助手 v2。模型能力判定、附件与路径双输入源、外发授权与超时合同。v1 附件链路已实现，v2 路径输入源待实施。

## 已完成 Feature 记录

- [`features/subtask-intervention-lifecycle.md`](./features/subtask-intervention-lifecycle.md)：子会话介入、Run 身份、委派结果固化和时间线投影的实施记录。现役用户合同以 `subtask-delegation.md` 为准。

## 待实施方案（设计已定稿，代码未落地）

- [`office-file-support-design.md`](./office-file-support-design.md)：PDF / DOCX / XLSX / PPTX 读取能力，附件入口与 Agent 工具入口（2026-08-17）。
- [`features/managed-browser-feature-plan.md`](./features/managed-browser-feature-plan.md)：内嵌受管浏览器 Feature 方案 v2，基于 Proma 调研（2026-08-13）。

## 架构决策

- [`adr/provider-adaptation-design.md`](./adr/provider-adaptation-design.md)：Provider 适配层设计。ProviderPreset 三元组已实现于 main，文档作为决策记录保留。

## 时间点调研（结论快照，供追溯）

`research/` 下的文档是特定日期的调研快照，结论已被对应实现消化或指导进行中的工作，不随实现同步更新：

- [`research/proma-latest-compaction-2026-08-11.md`](./research/proma-latest-compaction-2026-08-11.md)
- [`research/pi-compaction-session-quality.md`](./research/pi-compaction-session-quality.md)
- [`research/compaction-restart-session-switch-2026-08-13.md`](./research/compaction-restart-session-switch-2026-08-13.md)

## Agent 工作规则

- [`agents/`](./agents/)：domain、issue-tracker、triage-labels，当前有效。

## 其他

- [`images/`](./images/)：README 使用的产品截图资源。

## 历史归档

[`archive/`](./archive/)：被取代的设计、调研和旧时序材料，仅供追溯，不作为当前实现依据。

## 状态维护规则

- 设计文档头部标注状态（当前合同 / 待实施 / 已归档）与日期。
- 被新版本取代的文档移入 `archive/`，保留原文并加归档头说明取代关系。
- 调研报告以日期命名放入 `research/`，实现落地后不回改。
- `docs/` 全目录纳入版本控制，不进 `.gitignore`。
