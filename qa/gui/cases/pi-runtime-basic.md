# L3-RUNTIME-001 Pi Runtime 基础对话与文件工具

## 目标

验证用户选择 Pi Runtime 后，可以完成真实对话、文件与 MCP 工具调用、运行中引导、权限确认、中断和 Fork，并能在同一会话逐轮切换 Runtime。

## 前置条件

- 使用隔离 HOME。
- 已配置可用的 OpenAI 协议 Provider，包含 API key、baseUrl 和 model ID。
- 测试工作目录包含 `package.json`。

### 0. Provider 协议配置

动作：

- 打开 Provider 设置并新建火山 Agent Plan Provider。
- 分别观察 Anthropic 与 OpenAI 两个预设。
- 选择 OpenAI 预设并检查接口地址。

通过标准：

- Anthropic 预设显示 `/api/plan` 和 Anthropic Messages。
- OpenAI 预设显示 `/api/plan/v3` 和 OpenAI Chat Completions。
- 切换 Runtime 不会改变 Provider 的接口地址。
- OpenAI 协议 Provider 的 RuntimeSelector 中 Claude 不可选择，Pi 可选择。

## 步骤

### 1. Pi Runtime 对话

动作：

- 新建会话。
- 确认 RuntimeSelector 默认选择 Pi。
- 发送：`帮我读一下 package.json，并告诉我 package name。`

通过标准：

- 回复来自真实模型。
- 不显示 `Pi Runtime 尚未接入`。
- 过程区域显示 Read 工具调用及返回结果。
- 会话完成后仍可继续发送消息。

### 2. 会话历史复用

动作：

- 在同一会话追问：`刚才读取的 package name 是什么？`

通过标准：

- 模型能基于上一轮消息回答。
- 不要求用户重新提供 `package.json` 内容。

### 2.1 思考、工具与正文顺序

动作：

- 发送一条会触发模型思考后直接回复的消息。
- 发送一条会触发模型思考、Read 工具和最终回复的消息。

通过标准：

- 模型输出 thinking 时，过程区域先显示“正在思考”，正文随后出现。
- thinking 结束后过程摘要更新为“已完成分析”，不会在正文完成后延迟插入。
- Read 工具只显示一次，工具输入、结果和最终正文归属于同一个助手轮次。
- 折叠或展开过程区域不会改变正文顺序。

### 3. Claude Runtime 回归

动作：

- 使用同时支持 Claude 和 Pi 的 Anthropic Messages Provider。
- 在已有会话的 RuntimeSelector 选择 Claude，发送一条消息。
- 切回 Pi，再发送一条消息。
- 如果上一轮仍在运行，运行中修改 Runtime。

通过标准：

- Claude Runtime 正常返回回复。
- 流式文本、工具过程和会话持久化无异常。
- Runtime 切换只作用于下一轮，当前运行不受影响。
- 切回 Pi 后可以读取同一份 Zora 会话历史。

### 4. Provider 配置缺失

动作：

- 使用缺少 API key 或 model ID 的 Provider 发起消息。

通过标准：

- 界面提示缺失的 Provider 配置。
- 不调用 Pi 或 Claude Runtime。
- 会话保留用户选择的 Pi Runtime，补全配置后可以重试。

### 5. Pi 初始化失败

动作：

- 模拟 Pi Runtime 包加载或初始化失败。

通过标准：

- 界面提示 Pi Runtime 初始化失败。
- 不自动启动 Claude Runtime。
- 会话保留用户选择的 Pi Runtime，修复配置后可以重新发送。

### 6. Pi Provider 请求失败

动作：

- 将 Provider 接口地址配置为无法处理当前协议请求的地址。
- 使用 Pi Runtime 发送一条消息。

通过标准：

- 界面显示 Provider 返回的错误信息。
- 输入区退出运行状态，可以修改配置后重试。
- 主进程日志包含 `pi-runtime query:start` 和 `provider:error` 或 `query:error`。
- 会话仍保存用户选择的 Pi Runtime。

### 7. Pi 权限确认与中断

动作：

- 使用 Ask 模式要求 Pi 写入一个测试文件。
- 在权限弹层选择允许。
- 再发送一条会触发长响应的消息。
- 运行中追加一条引导消息，随后点击停止。

通过标准：

- Write 工具执行前显示 Zora 权限弹层，允许后继续执行。
- 点击停止后当前 Pi 请求结束，输入区恢复可用。
- 待处理的 steer 和 followUp 引导同时取消，不会在停止后重新触发模型调用。
- 同一会话可以继续发送下一条消息。

### 8. 运行中引导

动作：

- 发起一个包含思考或工具调用的长任务。
- 当前轮仍在运行时发送一条引导消息。

通过标准：

- 引导消息立即显示在当前会话中。
- 已经开始的思考或工具事件正常结束。
- Runtime 接受引导后继续同一轮执行，最终回复体现引导内容。
- 同一条引导消息只被处理一次。

### 9. 附件

动作：

- 上传一个文本文件，要求 Agent 返回其中的指定内容。
- 上传一张图片并发送给 Pi Runtime。

通过标准：

- 文本附件由 Zora 统一解析，Claude 与 Pi 得到相同内容。
- 图片直接传入当前 Runtime。
- Provider 或模型不支持图片时，界面显示明确错误，输入区恢复可用。
- Runtime 切换后，历史附件仍能进入后续轮次上下文。

### 10. 用户自定义 MCP

动作：

- 配置并启用一个 stdio MCP Server。
- 要求 Agent 调用该 Server 的工具。
- 在权限确认中选择允许。

通过标准：

- Claude 与 Pi 使用相同的 MCP 配置和工具名称。
- 过程区域显示 MCP 工具调用、授权状态和返回结果。
- 最终回复包含真实 MCP 工具结果。
- 已启用 Server 连接失败时显示错误，不静默移除工具。

### 11. AskUser、Todo 与 Usage

动作：

- 要求 Agent 通过 AskUser 询问一个选项问题并完成回复。
- 要求 Agent 创建 Todo 并逐项完成。
- 完成一次正常对话后查看用量信息。

通过标准：

- AskUser 只显示一次产品问答界面，选项和自由输入均可提交。
- Todo 工具调用和结果显示在过程区域。
- 完成事件包含标准化 token 用量，界面可查看该轮用量。

### 12. Fork

动作：

- 连续发送两轮不同信息。
- 从第一轮助手消息创建 Fork。
- 在新分支询问此前提供的信息。

通过标准：

- 新分支包含 Fork 点之前的历史。
- Fork 点之后的信息不会进入新分支。
- Claude 与 Pi 创建的会话均可 Fork，Fork 后可继续切换 Runtime。

## 问题分类

发现的问题归类为 `产品缺陷`、`体验问题`、`技术债`、`测试工具问题` 或 `规则待澄清`。
