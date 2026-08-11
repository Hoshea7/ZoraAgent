# 文档入口

当前实现以根目录 `README.md`、`src/`、`tests/` 和项目规则文件为准。

- `agents/`：Agent 工作规则，当前有效。
- `images/`：README 使用的产品截图资源。
- [`vision-relay-design.md`](./vision-relay-design.md)：视觉助手的模型能力判定、工具注册、附件边界和超时合同。
- [`subtask-delegation.md`](./subtask-delegation.md)：可见子任务的创建、权限、并发、等待和会话生命周期合同。
- `archive/`：历史设计、调研和旧时序材料，仅供追溯，不作为当前实现依据。

Runtime、会话、附件和引导行为以当前源码与 `tests/e2e/` 为准。
