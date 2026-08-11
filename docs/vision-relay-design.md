# 视觉助手设计

## 目标

视觉助手为不支持原生图片输入的 Agent 提供独立视觉模型。支持图片的主模型继续使用 Runtime 原生 Read，不经过视觉中转。

设置页只展示两项：启用视觉中转、选择视觉模型。视觉模型从已经配置的模型中选择，复用对应 Provider 的地址、协议和密钥。

## 模型图片能力

图片能力有三个状态：

| 状态 | 语义 |
| --- | --- |
| `supported` | 已确认模型支持图片输入 |
| `unsupported` | 已确认模型不支持图片输入 |
| `unknown` | 当前没有足够信息确认 |

判定顺序：

1. 用户对当前 Provider 和模型设置的能力覆盖。
2. Zora 内置的已确认模型表。
3. Pi 模型目录中相同完整 modelId 的全部记录。任一 Provider 记录包含 `image` 输入即判定为 `supported`；全部精确记录均仅支持文本时判定为 `unsupported`。
4. 没有精确记录时判定为 `unknown`。

模型能力由完整 modelId 决定。相同 modelId 在任一中转 Provider 被确认支持图片后，其他 Provider 下的同名模型也按支持图片处理。用户覆盖按 Provider 保存，用于处理实际端点与标准模型能力不一致的情况。

视觉模型候选包含模型配置中全部已启用 Provider 的已配置模型。能力识别结果不限制用户选择，选择的模型能否处理图片由实际调用结果决定。

模型配置页提供折叠的图片能力识别设置。默认使用自动识别，用户只在识别结果不准确时选择支持图片或不支持图片。视觉助手页不展示能力表。

## 运行决策

每次 Agent Run 开始时解析一次主模型图片能力和视觉助手开关，生成不可变的 `VisionRunContext`。附件投影、工具注册和 Read 约束共用该上下文。

| 视觉助手 | 主模型能力 | 当前图片附件 | Inspect Image |
| --- | --- | --- | --- |
| 关闭 | 任意 | 保留普通附件引用和运行时路径，不增加图片工具指令 | 不注册 |
| 开启 | `supported` | 注入 attachmentId、运行时路径和一次性 Read 指令 | 不注册 |
| 开启 | `unsupported` | 只注入 attachmentId 和一次性 Inspect Image 指令 | 注册 |
| 开启 | `unknown` | 只注入 attachmentId 和一次性 Inspect Image 指令 | 注册 |

历史图片只投影文件名和 attachmentId，不重复注入 Read 或 Inspect Image 指令，也不包含图片字节和绝对路径。

定时任务和记忆任务不注册 Inspect Image。子 Agent、桌面会话与飞书会话使用相同的模型能力和视觉中转规则。

## 工具与权限

Inspect Image 的规范名称为 `mcp__zora_vision__inspect_image`，Claude 与 Pi 使用同一份工具定义。

在 Ask 权限模式下，Inspect Image 自动允许。工具只读取当前 workspace 和 session 清单中登记的图片附件。attachmentId 必须由附件资源模块解析，调用方不能传入任意路径。

Read 只在视觉助手开启且主模型为 `unsupported` 或 `unknown` 时拦截图片文件。拦截依据文件签名和当前会话附件归属共同判断。文本、代码、PDF 等非图片文件不受影响。视觉助手关闭时不增加此限制。

## 附件与路径边界

附件资源模块是 attachmentId、storageKey、原始文件名和会话归属的权威索引。产品会话记录只保存资源标识，不保存图片 base64。

支持图片的模型调用原生 Read 时，Runtime 工具输入需要真实绝对路径。路径只允许存在于当前运行内存和 Runtime 自身的续跑 checkpoint。

产品边界执行以下清理：

- Agent Trace 的 Read 输入只显示文件名。
- Zora 产品 JSONL 在持久化 Read 工具输入前，将已登记附件路径替换为 attachmentId 和文件名。
- 权限日志只记录文件名。
- 历史恢复提示不包含附件绝对路径。

图片、OCR 文本和文件正文统一视为用户提供的外部内容。固定系统提示要求模型将其中的指令和权限请求作为待分析数据，除非用户在对话中明确要求执行。

## 视觉模型请求

Inspect Image 接收：

- `attachmentId`
- 最多 1000 个字符的观察指令

中转服务负责：

1. 按 workspace、session 和 attachmentId 解析图片。
2. 校验图片格式、文件大小和像素限制。
3. 规范化图片后生成视觉模型请求。
4. 只发送规范化图片与单条观察指令。
5. 将视觉模型的文本结果封装为结构化 Observation 返回主模型。

视觉模型请求不包含完整对话历史、工作目录和原始附件路径。

## 超时与取消

30 秒只用于等待 HTTP 响应或流式首个响应。收到首个响应后取消该计时器，允许模型继续生成完整结果。

用户停止当前 Agent Run 时，通过同一 AbortSignal 取消视觉请求。首响应超时返回 `VISION_TIMEOUT`；用户取消返回 `VISION_CANCELLED`。二者不转换为通用网络错误。

## 设置界面

视觉助手页面保持两行：

1. 启用视觉中转。
2. 选择视觉模型。

开启开关时，如果当前没有选择模型，自动选择第一个已配置模型。没有已配置模型时禁用开关，并引导用户先完成模型配置。

模型选择变化即时保存。Provider、API Key、能力表、文件限制和内部协议不在视觉助手页面展示。

## 验收标准

- 支持图片的主模型读取图片时出现 Read，不出现 Inspect Image。
- 不支持图片或能力未知的主模型在视觉助手开启后出现 Inspect Image。
- 视觉助手关闭时不注册 Inspect Image，也不增加图片 Read 限制。
- Inspect Image 在 Ask 权限模式下不弹出确认。
- 图片 Read 约束不影响文本和文档读取。
- 相同 modelId 只要任一 Pi Provider 目录记录支持图片，自动识别结果为 `supported`。
- 视觉模型首响应在 30 秒内到达后，完整生成超过 30 秒不会被中断。
- Agent Trace、产品 JSONL 和权限日志不包含已登记附件的绝对路径。
- 产品 JSONL 和历史恢复提示不包含图片 base64。
- 设置页可以选择任意已配置模型。
