# 运行时视觉资源与多模态 Agent 设计调研

日期：2026-08-17

## 调研范围

本文从用户任务、运行时资源和模型能力三个层面研究视觉助手的产品抽象。核对范围包括：

- OpenAI Responses API、Agents SDK 和 Computer use。
- Anthropic Claude Vision、Tool use 和 Computer use。
- Google Gemini API 和 Agent Development Kit（ADK）。
- 开源 Agent 产品 Cline。
- 本地 Proma 仓库的 Vision Relay、Bridge 附件和浏览器截图实现。
- Model Context Protocol（MCP）资源与工具结果规范。

外部资料仅使用官方文档、官方源代码和协议规范。Cline 核对版本为 [`041afb7`](https://github.com/cline/cline/tree/041afb718bcdfe50eabd90d060e5335ef98e2d16)，Proma 核对版本为 [`447169c`](https://github.com/proma-ai/Proma/tree/447169c791c4421c3e9618a45e1f2f3879b08282)。

## 结论

视觉助手的产品目标可以定义为：

> Agent 在完成用户任务的过程中，可以在授权范围内取得任务所需的视觉证据，完成针对当前任务的观察，并把观察结果继续用于判断、操作和验证。

这个目标包含四个相互独立的能力：资源发现、资源取得、视觉观察、任务推理。模型调用只承担视觉观察。用户上传图片是资源发现的一种入口，Agent 搜索到本机图片、工具返回截图、网页提供图片 URL、连接器返回平台文件句柄，也都属于同一能力的输入。

因此，Zora 当前沿着 `attachmentId / path / url` 扩展 Inspect Image 的方向能够覆盖主要传输形式，但这些字段属于资源定位方式。更稳定的产品抽象应以“视觉资源”和“视觉观察”作为中心：

1. 所有能产生图片的入口返回统一的视觉资源引用。
2. Agent 根据用户目标判断是否需要观察资源，用户无需逐次明确要求“看图”。
3. 资源解析、权限校验、图片规范化与 Provider 路由由运行时负责。
4. 原生多模态模型和视觉代理模型共享同一资源合同与观察结果合同，仅执行策略不同。
5. 权限按照资源访问、网络取得、向特定 Provider 外发、后续高影响操作分别判断。
6. 图片内容、OCR 文本和视觉观察均按不可信上下文处理。

当前方案可以沿用。需要补充的是资源模型、Agent 自主触发边界、统一的原生/代理执行策略、生命周期和端到端用户旅程。

## 1. 第一性原理：用户需要解决什么问题

### 1.1 用户购买的是任务完成能力

用户通常描述结果，例如：

- 检查这个页面有没有布局问题。
- 在资料目录中找到对应截图并整理结论。
- 比较生成稿和参考稿。
- 阅读飞书消息中的图片并继续处理任务。
- 下载报告里的图表，判断数据是否异常。

这些请求没有必要包含图片格式、文件路径、Provider 或视觉模型。图片只是完成任务时需要使用的一类证据。

OpenAI、Anthropic 和 Gemini 的工具调用默认都允许模型根据当前请求决定是否调用已配置工具；开发者可以再用 `tool_choice` 或指令约束触发边界。OpenAI 明确说明模型会根据提示自动决定是否使用工具；Anthropic 的 `auto` 模式会在请求与工具能力匹配且答案不在上下文时调用工具；Gemini Function Calling 也由模型判断何时返回函数调用。[OpenAI Using tools](https://developers.openai.com/api/docs/guides/tools#usage-in-the-api)、[Anthropic Tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview#when-claude-uses-tools)、[Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)

由此可以得到产品层的触发原则：

> 当视觉信息与当前用户目标相关，并且现有上下文不足以完成任务或验证结果时，Agent 可以自主取得并观察图片。

“用户是否明确说了看图”不应成为唯一条件。用户目标、资源相关性、授权范围和成本共同决定是否执行。

### 1.2 视觉能力解决四类断点

| 断点 | 用户现象 | 产品能力 |
| --- | --- | --- |
| 资源未被发现 | Agent 不知道目录、网页或工具结果中存在图片 | 资源发现 |
| 资源无法取得 | Agent 得到路径、URL 或平台句柄，但无法读取图片字节 | 资源解析与取得 |
| 模型无法理解 | 当前推理模型不支持图片输入 | 视觉观察路由 |
| 观察结果未进入任务 | 已经获得图片描述，但没有用于比较、操作或验证 | 任务推理与证据回传 |

当前视觉助手主要解决第三个断点。升级方案开始覆盖第二个断点。要形成完整产品能力，还需要正式处理第一个和第四个断点。

## 2. 图片资源来源的分类

### 2.1 场景分类

从用户旅程看，图片来源可以分成四组：

| 来源 | 典型场景 | 资源由谁引入 | 初始状态 |
| --- | --- | --- | --- |
| 用户直接提供 | 上传、拖放、粘贴截图、给出路径或 URL | 用户 | 已明确进入当前任务 |
| Agent 在工作空间发现 | 搜索目录、读取项目文件、检查会话文件 | Agent | 位于已授权本机范围 |
| 工具在运行中产生 | 浏览器截图、页面渲染、图表、生成图片、PDF 页面图 | 工具 | 当前任务的中间产物 |
| 外部系统返回 | Web 搜索结果、MCP 资源、飞书 image_key、第三方 API 文件句柄 | 外部工具或连接器 | 需要进一步下载或解析 |

Google ADK 的 Artifact 文档也把用户上传、工具或 Agent 生成的文件、中间二进制结果和跨会话用户文件视为同一类 Artifact 使用场景；Artifact 由独立服务管理，并支持 session 与 user 两种作用域。[Google ADK Artifacts](https://adk.dev/artifacts/)

Proma 已经出现这四组来源中的三组：Bridge 图片会保存到 session 的 `attachments` 目录并返回路径；Vision Relay 接受授权目录内的本机路径；BrowserScreenshot 直接返回图片内容块。[Proma Bridge attachment utils](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/main/lib/bridge-attachment-utils.ts#L74-L98)、[Proma Vision Relay](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/main/lib/vision-relay-service.ts#L43-L48)、[Proma BrowserScreenshot](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/main/lib/adapters/pi-builtin-tools.ts#L1014-L1031)

### 2.2 定位方式分类

同一场景可以使用不同的技术定位方式：

- 内联字节或 base64。
- 应用附件 ID。
- 本机路径或 `file:` URI。
- HTTP/HTTPS URL。
- Provider 文件 ID。
- 平台句柄，例如 image_key。
- MCP resource URI 或 resource link。

OpenAI 图片输入支持 URL、base64 data URL 和 Files API 的 file ID；Anthropic 支持 base64、URL 和 Files API file ID；Gemini 支持 URL、内联数据和 Files API URI。[OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision#giving-a-model-images-as-input)、[Anthropic Vision](https://platform.claude.com/docs/en/build-with-claude/vision#send-images-to-claude)、[Gemini Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding#passing-images-to-gemini)

MCP 将图片字节、资源链接和内嵌资源定义为不同内容类型。工具结果可以直接返回 `ImageContent`，也可以返回带 URI、MIME 和大小的 `ResourceLink`，由客户端按需读取。[MCP Tools specification](https://modelcontextprotocol.io/specification/draft/server/tools#tool-result)、[MCP Resources specification](https://modelcontextprotocol.io/specification/draft/server/resources#data-types)

这说明 `attachmentId / path / url` 适合作为 Resolver 的输入分支，但不适合作为产品场景的顶层分类。场景描述“为什么资源进入任务”，定位方式描述“运行时怎样找到字节”。

### 2.3 还需要三个正交维度

视觉资源至少还需要记录三类信息：

| 维度 | 取值示例 | 用途 |
| --- | --- | --- |
| 来源与生产者 | user、filesystem、browser、web、feishu、image-generator | Trace、错误恢复、来源说明 |
| 作用域与生命周期 | turn、session、workspace、user、external | 授权、持久化、清理 |
| 信任与外发状态 | untrusted、local-authorized、remote-fetched、sent-to-provider | 安全策略和用户可解释性 |

Google ADK 通过 session scope 和 user scope 管理 Artifact，并自动为同名 Artifact 建立版本；`LoadArtifactsTool` 允许模型按需选择 Artifact，加载内容只临时加入当前请求，不会永久写回会话历史。[Google ADK Artifact namespacing](https://adk.dev/artifacts/#namespacing-session-vs-user)、[Google ADK LoadArtifactsTool](https://adk.dev/artifacts/#using-loadartifactstool)

## 3. 资源获取、表示、视觉理解与任务推理的分层

### 3.1 推荐分层

```text
用户、文件工具、浏览器、连接器、生成工具
                  │
                  ▼
        资源发现与 VisualResourceRef
                  │
                  ▼
    Resolver：授权、下载、读取、格式校验、规范化
                  │
                  ▼
       VisualObservationPort：任务化视觉观察
          ├─ NativeMultimodalStrategy
          └─ RelayObserverStrategy
                  │
                  ▼
     VisualObservation：事实、文本、限制、来源
                  │
                  ▼
          主 Agent 继续推理、操作和验证
```

#### 资源发现层

负责回答“当前任务中有哪些可用图片”。它可以接收用户附件，也可以接收工具在运行中返回的图片引用。工具返回图片是成熟协议已经支持的能力：OpenAI Agents SDK 的函数工具可以返回一个或多个图片或文件；Anthropic 的 `tool_result.content` 可以包含 `image`、`document` 等内容块；MCP 工具结果可以包含图片、资源链接和内嵌资源。[OpenAI Agents SDK tools](https://openai.github.io/openai-agents-python/tools/#returning-images-or-files-from-function-tools)、[Anthropic Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls#handling-results-from-client-tools)、[MCP Tools specification](https://modelcontextprotocol.io/specification/draft/server/tools#tool-result)

#### 资源取得层

负责把稳定引用解析为经过授权和规范化的图片字节。该层应处理路径作用域、URL 下载、平台句柄下载、文件大小、MIME、像素数量、重编码和取消。调用方无需知道图片最终来自本机、网络或 Provider 文件服务。

Proma 的 Vision Relay 已实现本机路径的 allowed roots、真实路径解析、`O_NOFOLLOW`、inode 校验、大小限制、完整解码和 JPEG 重编码，这些属于 Resolver 的职责。[Proma Vision Relay path resolver](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/main/lib/vision-relay-service.ts#L54-L135)

#### 视觉观察层

负责回答任务化问题，例如“读取按钮文案”“比较两张稿件”“判断图表趋势”。它的输入应为规范化资源和聚焦的观察指令，输出应为结构化观察结果。

Proma 已经采用这种边界：视觉模型不接收完整 Agent 历史，只接收图片、最多 1000 字符的观察问题和限制输出结构的 system message；结果被包装为包含来源和 `untrustedSource` 的 JSON。[Proma Vision Relay request](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/main/lib/vision-relay-service.ts#L208-L240)

#### 任务推理层

负责决定是否需要视觉证据、怎样使用观察结果、是否需要补充观察，以及如何完成用户任务。视觉模型不应接管完整任务。OpenAI Agents SDK 的 agent-as-tool 允许主 Agent 保持用户答复所有权，只把专业任务交给子 Agent，并支持结构化输入、输出提取和审批。[OpenAI Agents as tools](https://openai.github.io/openai-agents-python/tools/#agents-as-tools)

### 3.2 推荐的资源合同

最低可行合同可以采用以下形态：

```ts
type VisualResourceLocator =
  | { type: "attachment"; attachmentId: string }
  | { type: "path"; path: string }
  | { type: "url"; url: string }
  | { type: "artifact"; uri: string }
  | { type: "platform"; provider: string; handle: string };

interface VisualResourceRef {
  id: string;
  kind: "image";
  locator: VisualResourceLocator;
  origin: {
    producer: "user" | "tool" | "connector" | "agent";
    toolName?: string;
  };
  scope: "turn" | "session" | "workspace" | "user";
  displayName?: string;
  mimeType?: string;
  sizeBytes?: number;
}
```

内置工具应返回该合同。第三方 MCP 已经返回标准 `ImageContent` 或 `ResourceLink` 时，Zora Host 可以转换为该合同。只返回自然语言 URL 或平台句柄的第三方工具继续按 best-effort 处理。

这个合同不要求所有资源立即下载。URL、平台句柄和 Artifact URI 可以保持惰性解析；Agent 决定观察后再取得字节。Google ADK 的 Artifact Service 与 `LoadArtifactsTool`、MCP 的 ResourceLink 都采用引用与加载分离的方式。[Google ADK Artifacts](https://adk.dev/artifacts/)、[MCP Resource links](https://modelcontextprotocol.io/specification/draft/server/tools#resource-links)

### 3.3 自动登记资源与显式决定感知

结论：现有协议的数据结构能够支持该分层，登记与加载语义需要由 Zora Host 实现。

MCP 的工具结果包含三种相关表示：`ImageContent` 携带 base64 图片字节，`EmbeddedResource` 携带内嵌资源，`ResourceLink` 携带可由客户端继续取得的 URI、MIME 和大小等元数据。前两种属于即时内容，`ResourceLink` 属于资源引用。MCP 规定了传输表示，没有规定 Host 必须把工具返回的图片登记为 Artifact，也没有规定模型何时感知该图片。[MCP Tool result](https://modelcontextprotocol.io/specification/draft/server/tools#tool-result)、[MCP Resource links](https://modelcontextprotocol.io/specification/draft/server/tools#resource-links)、[MCP Resources](https://modelcontextprotocol.io/specification/draft/server/resources)

主流 Agent 对图片工具结果通常采用即时感知：Anthropic 把 `tool_result.content` 中的 `image` 直接放入下一次模型请求；OpenAI Agents SDK 允许函数工具返回 `ToolOutputImage`，随后由 Agent 循环继续处理；Cline 将 `read_file` 产生的图片提升为原生 `image` 内容块，并直接传给支持图片的模型。[Anthropic tool result images](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls#handling-results-from-client-tools)、[OpenAI ToolOutputImage](https://openai.github.io/openai-agents-python/tools/#returning-images-or-files-from-function-tools)、[Cline image formatter](https://github.com/cline/cline/blob/041afb718bcdfe50eabd90d060e5335ef98e2d16/sdk/packages/shared/src/llms/ai-sdk-format.ts#L548-L605)

Google ADK 提供了更接近目标设计的实现：Artifact 由独立服务保存、命名和版本化，`LoadArtifactsTool` 让模型依据当前任务选择需要加载的 Artifact；被选中的二进制内容只加入当前模型请求，不写入持久会话历史。[Google ADK Artifacts](https://adk.dev/artifacts/)、[Google ADK LoadArtifactsTool](https://adk.dev/artifacts/#using-loadartifactstool)

Zora 可以据此定义以下运行语义：

```text
工具返回 ImageContent、ResourceLink、附件句柄或本机路径
                    │
                    ▼
Host 自动登记 VisualResourceRef，记录来源、作用域、信任和外发状态
                    │
                    ▼
主 Agent 先看到资源元数据和 resourceId
                    │
                    ▼
主 Agent 根据任务调用 InspectImage(resourceId, question)
                    │
                    ▼
Resolver 取得图片，VisualObservationPort 选择原生或视觉代理路径
```

对于 MCP `ImageContent`，Host 需要先把即时字节保存到 turn 或 session 作用域的受管资源，再向主 Agent 暴露引用。对于 `ResourceLink`，Host 可以直接登记引用并保持惰性取得。这样可以避免工具只要返回图片就触发 Provider 外发，也便于统一审计、去重和清理。

两类场景可以继续使用即时感知：用户本轮直接附图且任务明确依赖图片；Computer Use 的截图属于动作后的状态反馈，需要维持紧密的操作与观察循环。其他工具产出的图片默认采用登记后按需观察。

## 4. Agent 是否应在用户未明确要求看图时自主读取

结论：可以，触发范围需要由任务相关性和权限策略限定。

成熟实现已经采用模型自主选择：

- OpenAI 工具默认由模型依据提示决定是否使用。[OpenAI Using tools](https://developers.openai.com/api/docs/guides/tools#usage-in-the-api)
- Anthropic `tool_choice: auto` 由 Claude 逐轮决定调用工具或直接回答；Computer use 中 Claude 判断桌面工具是否有助于请求，并持续调用直到任务完成。[Anthropic Tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview#when-claude-uses-tools)、[Anthropic Computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#how-computer-use-works)
- Google ADK 的 `LoadArtifactsTool` 明确用于“由模型决定在回答前加载哪些 Artifact”。[Google ADK LoadArtifactsTool](https://adk.dev/artifacts/#using-loadartifactstool)
- Cline 的 `read_file` 在模型支持图片时把本机图片转成原生 `image` 内容块，浏览器动作也会捕获截图并返回当前 URL 和日志，形成 Agent 自主检查页面的视觉闭环。[Cline file read executor](https://github.com/cline/cline/blob/041afb718bcdfe50eabd90d060e5335ef98e2d16/sdk/packages/core/src/extensions/tools/executors/file-read.ts#L212-L251)、[Cline BrowserSession](https://github.com/cline/cline/blob/041afb718bcdfe50eabd90d060e5335ef98e2d16/apps/vscode/src/services/browser/BrowserSession.ts#L430-L478)

Zora 可以使用以下决策规则：

```text
视觉观察需要同时满足：
1. 图片可能包含完成当前用户目标所需的信息，或可用于验证 Agent 刚完成的视觉产物；
2. 现有文本、DOM、结构化工具结果不足以得到同等可靠的结论；
3. 资源访问和向目标 Provider 外发已经获得授权；
4. 预期收益高于延迟、Token 和外发成本。
```

建议允许的自主场景：

- 用户要求检查页面，Agent 先使用 DOM 或结构化信息，必要时截图验证视觉布局。
- 用户要求整理目录资料，Agent 在目录中发现与任务直接相关的图片。
- Agent 生成图片、图表或页面后，通过截图或产物文件完成质量检查。
- 连接器返回图片附件，用户请求依赖附件内容，但没有再次说明“读取图片”。

建议避免的行为：

- 扫描工作区后批量观察所有图片。
- 仅因为工具结果包含图片就自动外发。
- 已有结构化数据足以回答时仍重复使用视觉模型。
- 在后台任务、子 Agent 或新 Provider 目标中沿用未明确继承的外发授权。

这一区分对应“资源可用”和“资源需要观察”两个状态。生产者只声明资源，主 Agent决定是否消费。

## 5. 原生多模态模型与视觉代理模型的统一

### 5.1 统一产品能力，保留两种执行策略

用户看到的能力可以统一为“查看图片”或“使用视觉证据”。运行时根据主模型能力选择执行策略：

| 策略 | 处理方式 | 返回主 Agent 的内容 |
| --- | --- | --- |
| 原生多模态 | Resolver 取得图片后，以原生 image content 交给当前模型 | 当前模型直接观察 |
| 视觉代理 | Resolver 取得图片后，交给单独视觉模型，主模型接收结构化 Observation | 文本或结构化工具结果 |

OpenAI、Anthropic、Gemini 和 MCP 都把图片定义为正式内容类型，工具结果也可以携带图片。Cline 在 provider 适配层把工具结果中的图片提升为原生多模态 part，防止 base64 被序列化成不可理解的 JSON 文本。[OpenAI input image](https://developers.openai.com/api/docs/guides/images-vision#giving-a-model-images-as-input)、[Anthropic tool result images](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls#handling-results-from-client-tools)、[Gemini image input](https://ai.google.dev/gemini-api/docs/image-understanding#passing-images-to-gemini)、[Cline AI SDK format](https://github.com/cline/cline/blob/041afb718bcdfe50eabd90d060e5335ef98e2d16/sdk/packages/shared/src/llms/ai-sdk-format.ts#L548-L605)

Proma 展示了代理策略：只对符合条件的 text-only DeepSeek V4 注册 VisionRelay，Agent 自主传入授权图片路径和观察问题，结果作为 JSON 返回。[Proma VisionRelay tool](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/main/lib/adapters/pi-builtin-tools.ts#L856-L885)

### 5.2 统一点应放在 Resolver 与 Observation

建议内部接口：

```ts
interface VisualObservationRequest {
  resource: VisualResourceRef;
  instruction: string;
}

interface VisualObservation {
  resourceId: string;
  answer: string;
  observations: string[];
  extractedText?: string;
  limitations: string[];
  observer: {
    strategy: "native" | "relay";
    providerId: string;
    modelId: string;
  };
  untrustedSource: true;
}
```

原生策略在同一 Agent Run 中生成 Observation；代理策略通过独立视觉调用生成 Observation。两种策略都使用相同资源解析、安全规则、Trace 字段和验收标准。

工具层有两种可行设计：

1. 始终向 Agent 暴露 `InspectImage`，内部选择 native 或 relay。
2. 原生模型使用 Runtime 的 Read/image content，text-only 模型使用 `InspectImage`，产品 Trace 再统一映射为 VisualObservation。

第二种设计对现有 Runtime 改动较小。第一种设计的产品语义和跨 Runtime parity 更清楚。后续以 Pi 为核心 Runtime 时，可以评估第一种设计；本次升级可以继续使用第二种设计，同时确保 E2E 按用户结果断言，不依赖工具名称完全相同。

### 5.3 不应直接照搬 Cline 的 text-only 行为

Cline 的文件读取器在模型不支持图片时直接返回错误，provider 格式化层也会把图片替换成“模型不支持图片”的占位文本。[Cline file read executor](https://github.com/cline/cline/blob/041afb718bcdfe50eabd90d060e5335ef98e2d16/sdk/packages/core/src/extensions/tools/executors/file-read.ts#L231-L251)、[Cline image fallback](https://github.com/cline/cline/blob/041afb718bcdfe50eabd90d060e5335ef98e2d16/sdk/packages/shared/src/llms/ai-sdk-format.ts#L558-L577)

这种实现适合只依赖当前 Provider 能力的编码 Agent。Zora 已经存在用户选择的视觉 Provider，能够把 text-only 主模型的能力差异放到路由层解决。Cline 的内容块规范化方式可以借鉴，text-only fallback 不适合作为 Zora 的终态。

## 6. 权限、外发和生命周期

### 6.1 将权限拆成四个动作

| 动作 | 示例 | 风险 |
| --- | --- | --- |
| 发现资源 | 列目录、收到 MCP resource link | 暴露元数据 |
| 取得内容 | 读取本机文件、下载 URL、解析平台句柄 | 本机数据访问、SSRF、连接器权限 |
| 外发观察 | 把图片发送给指定视觉 Provider | 隐私与数据接收方变化 |
| 后续操作 | 根据截图点击、提交、删除、发送 | 现实副作用 |

视觉理解属于只读观察，但当图片从本机发送到第三方 Provider 时，会产生独立的数据外发边界。Cline 将读取工作区文件、读取工作区外文件、浏览器和 MCP 分为不同自动批准类别；OpenAI Agents SDK 允许按工具调用或动态条件要求批准，并可暂停、序列化和恢复整个 Run；Google ADK Tool Confirmation 允许工具暂停后向用户请求布尔或结构化确认。[Cline Auto Approve](https://github.com/cline/cline/blob/041afb718bcdfe50eabd90d060e5335ef98e2d16/docs/features/auto-approve.mdx)、[OpenAI Agents SDK HITL](https://openai.github.io/openai-agents-python/human_in_the_loop/)、[Google ADK Action confirmations](https://adk.dev/tools-custom/confirmation/)

Proma 当前设置页采用一次性明确授权：用户选择视觉模型后，页面说明 Agent 可在需要时将当前会话或用户已附加目录中的图片和聚焦问题发送给该模型，普通用户会话不再逐次确认。[Proma Vision Relay settings](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/renderer/components/settings/VisionRelaySettings.tsx#L40-L84)、[Proma VisionRelay tool description](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/main/lib/adapters/pi-builtin-tools.ts#L863-L879)

对 Zora 的建议：

- 设置级授权必须展示图片接收方的 Provider 和模型。
- 授权对象包含资源作用域与接收方；更换接收方后需要重新确认或明确展示变化。
- 当前会话附件和已授权工作区可以按策略自动观察。
- 工作区外路径、新连接器、新 Provider 和后台执行需要独立策略。
- 图片观察成功不代表后续点击、提交或发送自动获批；高影响操作继续走原工具审批。

### 6.2 图片内容按不可信输入处理

Anthropic 明确说明网页或图片中的指令可能形成提示注入，并建议隔离敏感数据与高影响操作；其 Computer use 在截图中检测到潜在提示注入时会引导模型请求用户确认。Anthropic 对普通工具结果也要求将网页、邮件、上传文件和第三方 API 内容保留在 `tool_result` 中，按不可信内容处理。[Anthropic Computer use security](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#security-considerations)、[Anthropic tool result security](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls#handling-results-from-client-tools)

OpenAI Computer use 同样要求在隔离浏览器或 VM 中运行、对高影响操作保留人工确认，并把页面内容视为不可信输入。[OpenAI Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use#prepare-a-safe-environment)

Google ADK 将间接提示注入、数据外泄和未经授权的工具行为列为 Agent 风险，并建议在工具内部实施确定性边界、使用回调或插件检查工具输入输出。[Google ADK Safety](https://adk.dev/safety/#safety-and-security-risks)

因此，Zora 的 Observation 应保留 `untrustedSource: true`，主 Agent 的 system policy 应明确禁止执行图片或 OCR 中的指令。视觉模型只提供观察，不能获得工具权限。

### 6.3 生命周期

推荐生命周期：

| 资源 | 默认生命周期 | 持久化内容 |
| --- | --- | --- |
| 用户上传附件 | session | 本地文件与稳定 attachmentId |
| Agent 临时下载或截图 | turn 或 session | 本地临时文件与资源引用 |
| 工作区已有图片 | workspace 原始生命周期 | 只保存引用，不复制原文件 |
| Provider 文件 ID | 与 Provider TTL 对齐 | Provider、模型、file ID、到期时间 |
| VisualObservation | session Trace | 结构化文本、来源、模型、限制 |
| base64 图片 | 单次请求 | 不写入产品 JSONL 和普通日志 |

Provider 文件服务有自己的生命周期。Gemini Files API 文件在 48 小时后自动删除，也支持主动删除；Anthropic 建议多轮 Agent 工作流对重复图片使用 Files API file ID，避免每轮在完整历史中重发 base64。[Gemini Files API](https://ai.google.dev/gemini-api/docs/files#delete-uploaded-files)、[Anthropic Vision Files API](https://platform.claude.com/docs/en/build-with-claude/vision#files-api-image-example)

Google ADK 的 Artifact 进一步说明二进制资源不应直接放在 session state 中，而应交给独立 Artifact Service 管理、版本化和按作用域加载。[Google ADK Artifacts](https://adk.dev/artifacts/#why-use-artifacts)

Zora 可以保留 session 附件目录作为本地 Artifact Store 的最小实现。Provider file ID 只作为派生缓存，不作为资源唯一事实来源。会话删除、临时任务结束或用户主动清理时，删除本地临时资源，并在 Provider 支持时删除远端上传。

## 7. 成熟实现对比

| 实现 | 资源表示 | 自主触发 | 模型适配 | 权限与生命周期 | 可借鉴点 |
| --- | --- | --- | --- | --- | --- |
| OpenAI Responses / Agents | URL、base64、file ID；工具可返回图片和文件 | 默认由模型决定，可用 tool_choice 约束 | 原生 image content；专业 Agent 可作为工具 | 工具批准、Run 暂停恢复、Computer use 隔离 | 工具结果的多模态内容、运行级审批、专业观察器作为工具 |
| Anthropic Claude | base64、URL、file ID；tool_result 可含 image | `auto` 逐轮判断；Computer use 持续 Agent loop | 图片为正式 message/tool result 内容块 | 图片与网页按不可信内容；高影响操作确认 | 图片工具结果保持在原 tool_result、最小上下文、提示注入边界 |
| Gemini / ADK | URL、inline、Files URI；Artifact 为命名版本化 Part | Function Calling 与 LoadArtifactsTool 由模型选择 | Gemini 原生多模态；ADK Artifact 独立于模型上下文 | session/user scope、临时加载、工具确认、Files TTL | 资源与会话状态分离、作用域、版本、按需加载 |
| Cline | 用户图片和工具图片统一为内容块；本机图片读取为 base64 | Agent 调用 read_file 和浏览器工具 | 支持图片时转换为原生 part；text-only 时错误或占位 | 按读取、浏览器、MCP 等类别批准 | Provider 适配层统一内容块、浏览器截图闭环、能力字段传播 |
| Proma | 授权本机路径；Bridge 图片落 session 目录；截图返回 image block | VisionRelay 工具描述允许 Agent 在需要时调用 | DeepSeek V4 使用单独视觉 Provider，返回 JSON | 设置级接收方授权、allowed roots、禁用 automation/delegation | 最小外发、结构化 Observation、本机路径安全、显式路由 |

## 8. 对 Zora 当前方案的判断

### 8.1 已满足的部分

当前方案已经覆盖以下关键设计：

- text-only 主模型使用独立视觉 Provider。
- Agent 显式决定何时调用视觉助手。
- attachment、path、url 进入统一图片规范化流程。
- 视觉 Provider 只接收图片和聚焦指令。
- 结构化 Observation 返回主 Agent。
- 本机路径、网络下载、图片格式和提示注入有独立安全要求。
- 用户可以在设置中选择图片接收模型。

这些设计与 OpenAI、Anthropic、Google ADK、Cline 和 Proma 的成熟模式一致。

### 8.2 需要沿第一性原理补充的部分

#### 产品目标

将目标从“让 text-only 模型支持图片输入”扩展为“让 Agent 在任务中取得并使用视觉证据”。前者仍然是主要技术动因，后者能够覆盖用户没有指定图片类型、Agent 运行中发现图片和工具产出图片的场景。

#### 场景模型

文档先按用户直接提供、工作空间发现、工具产生、外部系统返回描述场景，再把 attachment/path/url/platform handle 定义为 Resolver 支持的定位方式。

#### 生产者合同

Zora 内置工具和连接器返回 `VisualResourceRef` 或标准 image/resource 内容块。Agent 不需要从任意自然语言工具结果中识别 URL、路径或平台句柄。

#### 自主触发边界

明确允许 Agent 在任务需要和结果验证场景中自主观察，禁止无目的批量查看。工具描述、system policy 和 E2E 共同验证该边界。

#### 原生与代理统一

定义统一的 VisualObservation 结果和 Trace。原生 Read 与 Inspect Image 可以暂时保留不同工具名，产品验收按资源、观察和任务结果统一。

#### 生命周期

区分本地 Artifact、Provider file ID、内联请求字节和 Observation。定义 session 清理、Provider 删除和日志脱敏规则。

## 9. 建议的 Before / After 用户旅程

| 场景 | Before | After | 关键验收 |
| --- | --- | --- | --- |
| 用户上传图片 | 只有部分模型或附件链路能够理解 | 图片登记为 session 视觉资源，Agent 按任务观察 | 用户无需了解模型能力；最终回答使用图片证据 |
| 用户给出本机路径 | text-only 模型读取失败，要求重新上传 | 路径经授权 Resolver 转成视觉资源 | 不要求重复上传；Trace 包含资源取得和观察 |
| Agent 在目录中发现图片 | 文件工具只返回路径，任务中断 | 文件工具返回 VisualResourceRef，Agent 判断是否观察 | 工具顺序为发现、观察、完成任务 |
| 浏览器或生成工具产出图片 | 图片只在 UI 展示或作为 base64 工具结果存在 | 工具结果登记为 turn/session 资源，Agent 可做质量检查 | Agent 可以验证自己生成的视觉结果 |
| 连接器返回平台句柄 | 主 Agent 无法直接消费 image_key | 领域工具解析并返回统一资源引用 | 连接器授权与视觉外发授权分别生效 |
| 主模型原生支持图片 | 走 Runtime 原生图片输入 | 保持原生策略，Trace 映射为统一观察 | 没有额外视觉 Provider 调用 |
| 主模型不支持图片 | 任务失败或要求换模型 | 视觉代理生成结构化 Observation | 主模型继续完成原任务 |
| 视觉接收方变化 | 用户可能不知道图片发给谁 | 设置页显示 Provider 和模型，变化时重新确认 | 审批和审计记录包含接收方 |

## 10. E2E 与测试重点

E2E 需要验证完整用户任务，并覆盖用户没有明确说“看图”的路径。

### L3 E2E 发布用例

1. 用户上传一张内容确定的图片并提出依赖图片的问题。验证图片被观察，最终答案包含确定信息。
2. 用户要求整理一个目录。目录中同时包含文本和一张与任务相关的图片，用户没有要求“读取图片”。验证 Agent 发现图片后自主观察，并把结果用于最终报告。
3. 用户要求打开页面并检查布局。验证 Agent 优先使用 DOM/结构化观察，随后在视觉验证需要时截图，最终回答包含可验证的布局结论。
4. 用户要求生成或渲染一张图片并检查结果。验证生成工具返回资源、视觉观察发生在生成之后、最终答复包含质量检查结论。
5. 用户要求处理连接器消息中的图片。验证平台句柄由领域工具解析，视觉 Provider 只收到规范化图片。
6. 在同一任务上分别使用原生多模态主模型和 text-only 主模型。验证用户结果一致，Trace 中的执行策略分别为 native 与 relay。
7. 切换视觉 Provider 后再次观察图片。验证 UI 展示新接收方，并按产品策略要求重新确认。
8. 视觉助手关闭、模型失效、资源越权和用户取消。验证 Agent 给出可执行恢复动作，且不进入重复调用。

### Trace 断言

- 资源生产者、resourceId、source type 和 scope 可见。
- 图片字节和 base64 不进入产品 JSONL、普通日志或最终答复。
- 观察记录包含 native/relay、Provider、模型、资源 ID 和限制。
- 图片或 OCR 中的指令不会触发后续工具调用。
- 高影响操作仍走原有审批，视觉观察不会扩大操作权限。
- Agent 没有要求用户把已授权的本机或连接器图片重新上传。

### L1/L2 重点

- 每种 locator 到统一 Resolver 的转换。
- 内置工具返回 VisualResourceRef 的 schema parity。
- MIME、文件头、像素、大小、重编码、取消和超时。
- allowed roots、符号链接替换、URL SSRF 和连接器权限。
- 原生与代理策略生成一致的 VisualObservation 字段。
- session、workspace、user 生命周期和清理。
- 同一资源在一个 Run 中避免无意义重复外发。
- 第三方 MCP 的 ImageContent、ResourceLink 和 EmbeddedResource 转换。

## 11. 不建议直接照搬的实现

- OpenAI、Anthropic 和 Gemini 的 API 输入格式只描述 Provider 传输，不负责本机授权、连接器句柄、产品作用域和外发同意。Zora 需要自己的资源层。
- Cline 将模型能力作为图片读取成败条件，缺少独立视觉代理。Zora 不应让 text-only 主模型直接退化为错误或占位文本。
- Google ADK 的完整 Artifact Service 包含版本化和多种存储后端。Zora v2 可以先用 session 附件目录和稳定引用，不需要同时建设通用云 Artifact 平台。
- Anthropic 和 OpenAI 的 Computer use 面向持续 GUI 操作，截图属于控制循环。普通图片理解不需要引入完整 Computer use 运行时。
- Proma 当前 VisionRelay 只接受本机 path，并按具体 DeepSeek 模型 ID 注册工具。Zora 应将模型能力判断和资源来源扩展放在运行时合同中，避免长期绑定单个模型名称。
- MCP 的 ToolAnnotations 是提示，协议说明客户端不应把注解视为可信安全声明。Zora 仍需执行自己的权限策略。[MCP Tools specification](https://modelcontextprotocol.io/specification/draft/server/tools#tool-annotations)

## 12. 建议写入设计文档的核心定义

```text
视觉助手是一项运行时视觉证据能力。

当完成用户任务需要图片中的信息时，Zora 可以在用户授权范围内发现并取得图片资源，
选择原生多模态模型或已配置视觉模型完成任务化观察，
再由主 Agent 使用观察结果继续推理、操作和验证。

图片资源可以由用户直接提供、由 Agent 在已授权工作空间中发现、
由工具在运行中产生，或由外部系统返回。

图片内容、OCR 文本和观察结果均按不可信上下文处理。
资源访问、向视觉 Provider 外发和后续高影响操作分别执行权限判断。
```

这一定义能够覆盖当前附件链路，也能够覆盖 path、URL、浏览器截图、生成图片、MCP 图片结果和连接器平台句柄。后续视频、PDF 页面图和桌面截图可以继续复用资源层与观察层，不需要改变产品目标。
