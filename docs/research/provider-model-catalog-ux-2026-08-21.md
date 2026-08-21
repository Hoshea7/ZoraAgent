# 多 Provider、多模型目录与选择交互 Feature 设计

状态：已实施

日期：2026-08-21

## 结论

Zora 当前将一个 Provider 表示为一个主模型 `modelId` 加四个 Claude Agent SDK 角色模型。这个结构已无法表达一个连接可提供多个模型、且每个模型具有不同上下文窗口、输入能力、推理能力与协议覆盖的事实。Pi 已将 Provider 和 `models[]` 作为一等配置层级，VS Code 也将 Provider 连接、模型目录、模型可见性、当前会话选择拆分管理。

建议将 Provider 定义为连接配置，模型定义为连接下的可管理目录条目。每个可选模型的稳定标识为 `{ providerId, modelId }`。配置页只增加“已启用模型”和“可用模型”，支持手动添加、从 Provider 获取以及启用切换。现有默认模型、会话、视觉和记忆选择器继续使用当前交互，只将选项来源改为 Provider 下的已启用模型。

本次建议以 Pi 为主运行时设计：把选中的模型及其元数据编译为 Pi `ModelRuntime.registerProvider()` 的完整注册项。Claude Agent SDK 的角色环境变量不再作为 Provider 的模型配置方式。当前 `modelId`、`roleModels`、`contextWindow` 三个 Provider 级字段应在改造后移除，`contextWindow` 移至具体模型。

自动路由不进入首个版本。它需要实时可用性、费用、限额和任务复杂度信号，现有 Zora 没有这组可信数据。首个版本保持用户明确选择的会话模型。

## 当前实现与问题

| 位置 | 现象 | 影响 |
| --- | --- | --- |
| `src/shared/types/provider.ts:1-85` | `ProviderConfig` 只有一个 `modelId`、Provider 级 `contextWindow` 与 `roleModels`。 | 目录无法表示任意数量模型，也无法承载模型级能力和限制。 |
| `src/renderer/components/settings/ProviderSettings.tsx:56-122` | 配置页将 Sonnet、Opus、Haiku、小模型等字段解释为探索、规划、快速响应、摘要压缩。 | 页面术语和存储结构绑定 Claude Agent SDK 的角色模型机制。 |
| `src/renderer/utils/provider-selection.ts:15-44` | 选择器把主模型和角色模型合并成可选项。 | 可选模型列表来自角色字段，新增模型必须改 Provider 表单。 |
| `src/shared/provider-model.ts:13-30` | 模型可用性仅以 `modelId` 与 `roleModels` 中是否出现判断。 | 无法表达模型的可见性、来源、失效、能力、收藏与元数据覆盖。 |
| `src/main/runtime/pi-provider-registry.ts:10-29` | Pi Provider 注册输入只带一个 `model` 和一个 Provider 级 `contextWindow`。 | 同一 Provider 下不同模型的窗口、最大输出、协议和能力无法正确进入 Pi。 |

会话已经持久化 `providerId` 与 `selectedModelId`，这是正确的目标身份形式。新目标只允许选择 Provider 目录中的已启用模型；历史会话继续按已保存的二元引用解析。

## Proma 调研

本节基于 Proma 本地工作树 `447169c791c4421c3e9618a45e1f2f3879b08282`，与该提交对应的公开源码链接一并列出。

### Channel 与模型数据模型

Proma 将 Channel 定义为一个 Provider 连接：名称、Provider 类型、Base URL、加密凭据、启用状态以及 `models: ChannelModel[]`。每个模型有 API 使用的 `id`、显示名称、启用状态和 `manual`/`fetched` 来源。[本地定义](/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/channel.ts:262)；[公开源码](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/packages/shared/src/types/channel.ts#L262-L326)。

这个层级划分适合 Zora：Provider 连接保存认证与传输默认值，模型条目保存对上游模型 ID 的引用和用户选择状态。Proma 将凭据继续放在 Channel 内并通过 Electron `safeStorage` 加密，这个存储边界也与 Zora 当前 Provider Manager 的职责一致。

### 目录发现和手动模型

Proma 的模型拉取器按协议和 Provider 选择模型列表端点：OpenAI 兼容端点使用 `GET /models`，Anthropic、Google、订阅型 Provider 与没有模型列表接口的 Provider 分别走专用解析、Pi 内置目录或预设目录。[调度入口](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts:1640)；[公开源码](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/main/lib/channel-manager.ts#L1640-L1718)。

刷新成功后，Proma 采用如下合并规则：

- `manual` 模型即使本次拉取未返回也保留。
- 已存在的拉取模型保留原启用状态。
- 新发现模型默认未启用。
- 拉取列表内不存在且来源为 `fetched` 的旧条目被移除。

这段规则见 [ChannelForm](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/ChannelForm.tsx:639)；[公开源码](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/renderer/components/settings/ChannelForm.tsx#L639-L681)。它避免上游模型列表膨胀后自动占满聊天选择器，也允许不开放列表接口的中转服务继续接入。

模型管理页把条目分为“已启用模型”和“可用模型”。用户可刷新目录、搜索未启用模型、逐项启用或移除，并直接输入模型 ID 和可选显示名手动添加。[界面实现](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/ChannelForm.tsx:1114)；[公开源码](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/renderer/components/settings/ChannelForm.tsx#L1114-L1289)。

可用于 Zora 的部分是“发现目录”和“用户可见目录”分离。Proma 页面在模型很多时才显示搜索框，Zora 的目标场景包含聚合网关和多个模型，搜索应从第一版就存在，并同时匹配显示名、API 模型 ID 和 Provider 名称。

### 模型选择器

Proma 先从已启用 Channel 与模型构建扁平选项，再按 Channel 分组；当前选项的身份由 `channelId + modelId` 组成。[选项生成与分组](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ModelSelector.tsx:39)；[公开源码](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/renderer/components/chat/ModelSelector.tsx#L39-L82)。弹窗打开时刷新 Channel 列表，支持搜索、键盘导航并把结果写入对话元数据。[交互实现](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/chat/ModelSelector.tsx:125)；[公开源码](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/renderer/components/chat/ModelSelector.tsx#L125-L243)。

Provider 分组、搜索和会话级二元选择可直接借鉴。Proma 当前缺少收藏、最近使用和能力过滤，模型过百时仅靠 Provider 分组与关键词搜索仍有选择成本。

### Pi 模型注册

Proma 为每次 Agent 运行创建 `ModelRuntime`，将当前选中的模型编译为一个动态 Provider 注册项。该项包含 API 类型、Base URL、输入类型、推理能力、兼容性配置、上下文窗口与最大输出 token。[实现](/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/adapters/pi-model-registry.ts:731)；[公开源码](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/main/lib/adapters/pi-model-registry.ts#L731-L776)。

这说明产品无需为每个已发现模型常驻创建 Pi Runtime。目录管理可以保存多模型信息；执行前只需解析当前 `ModelTarget` 并注册它对应的完整 Pi 模型定义。Proma 对未知模型给出默认窗口和输入能力，这些默认值仅适合保证调用链可运行。涉及图像、工具调用、上下文计算等功能时，Zora 应在 UI 中区分已确认能力和未知能力。

## Pi 运行时调研

Pi 的自定义模型格式本身就是“Provider 默认配置 + `models[]`”结构。最小示例只要求每个模型有 `id`，一个 Provider 可配置多个模型。[Pi 模型文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#minimal-example)。Provider 级 `api`、`baseUrl`、认证与兼容性可作为默认值；模型条目可以覆盖 API 类型、显示名、`input`、`reasoning`、`contextWindow`、`maxTokens` 和成本等元数据。[完整示例与 API 配置说明](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#full-example)。

Pi 支持的 API 类型包括 `openai-completions`、`openai-responses`、`anthropic-messages` 与 `google-generative-ai`，且 API 类型可在模型级覆盖 Provider 默认值。[官方文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#supported-apis)。这一点覆盖了代理网关里一个连接下存在多种协议模型的情况。

`ModelRuntime.registerProvider(providerId, config)` 会验证并重组动态 Provider。重复注册会将已定义字段合并到先前注册，因此复用同一 Runtime 时必须传入完整的不可变配置，或在模型切换时建立新的 Runtime，避免旧模型字段残留。[Pi 源码](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/model-runtime.ts#L3089-L3169)。Zora 当前每次 Pi 运行都可构造一个运行时目标，使用“每次运行新 Runtime + 完整模型注册”会更直接。

Pi 对 OpenAI 兼容服务特别提供 `compat` 配置，例如不支持 `developer` role 或 `reasoning_effort` 时在 Provider 或单个模型层覆盖。[Pi 模型文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#minimal-example)。该字段应只在高级配置中暴露。常规 Provider 配置不需要让用户填写 Pi 内部兼容性字段。

## VS Code Copilot 调研

VS Code 的公开模型管理设计将 Provider 与模型分开：每个 Provider 管理自己的模型集合，Provider 有唯一 `vendor` 和可读显示名，敏感配置由 Provider 的配置 schema 管理。[Language Model Chat Provider 贡献点](https://github.com/microsoft/vscode-docs/blob/main/api/references/contribution-points.md#contributeslanguagemodelchatproviders)。

模型管理器展示模型能力、上下文大小、计费信息和可见性，默认按 Provider 分组；支持名称搜索、Provider 过滤、能力过滤和可见性过滤。[VS Code 模型管理文档](https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/language-models.md#manage-language-models)。模型选择器提供固定置顶区；源码中分别持久化最近使用列表、置顶模型标识与隐藏模型标识。[最近使用与置顶接口](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/languageModels.ts#L3219-L3279)，[可见性接口](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/languageModels.ts#L3281-L3335)。

VS Code 的 Custom Endpoint 允许 Provider 指定默认 API 类型和 URL，模型可按需覆盖；每个模型还可带 tool calling、视觉输入、上下文窗口、最大输出、thinking 和推理强度支持等元数据。[Custom Endpoint 配置参考](https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/language-models.md#custom-endpoint-configuration-reference)。在 Agent 场景中，缺少工具调用能力的模型不进入 Agent 选择器。[官方说明](https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/language-models.md#add-a-model-from-a-built-in-provider)。

以下交互可作为长期候选：

- 配置页负责 Provider 连接和模型目录，聊天选择器只承担当前会话选择。
- 已启用与隐藏状态独立于模型发现结果，避免所有上游模型进入选择器。
- 选择器顶部固定收藏模型，其后为最近使用，再按 Provider 展开全部已启用模型。
- 只对当前 Agent 功能可用的模型开放选择；已知不支持工具调用或图像输入的模型显示明确原因。
- 推理强度只对已确认支持 reasoning 的模型显示，并按会话保存。VS Code 也只在模型支持时显示该子选择器。[交互说明](https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/language-models.md#configure-thinking-effort)。

本次 Feature 只采用 Provider 与模型分层、模型启用状态和 Provider 分组。收藏、最近使用、能力过滤和新的搜索选择器退出首个版本。

以下部分不进入当前范围：

- Copilot 的 `Auto` 模型选择依赖任务复杂度、实时可用性和产品限额数据。[官方说明](https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/language-models.md#use-auto-model-selection)。Zora 目前没有可靠的同类数据源。
- Copilot 的组织策略、计费展示和扩展市场不属于本次本地 Provider 配置改造。

## Zora Feature 设计

### 必要性判断

本次必须完成的内容如下：

| 内容 | 原因 |
| --- | --- |
| `ProviderConfig.models[]` | 当前结构无法表达一个连接下的多个模型。 |
| 模型 `enabled` 状态 | Provider 返回完整目录后，需要由用户选择实际使用的模型。 |
| 手动添加模型 | 部分中转服务和本地服务没有模型列表接口。 |
| 从 Provider 获取模型 | 避免用户逐个输入公开目录中的模型 ID。 |
| 精确解析 `{ providerId, modelId }` | 防止找不到模型时切换到同 Provider 的其他模型。 |
| Pi 读取模型级元数据 | 同一 Provider 下不同模型的窗口和输出限制可能不同。 |
| Claude 统一角色映射 | 删除角色模型字段后仍需保证子 Agent 和压缩使用可用模型。 |

本次不需要重新设计整个模型管理产品。当前页面和选择器已经覆盖 Provider 添加、默认模型、会话模型、视觉模型和记忆模型。它们只需要改为读取 `models[]`。

### 设计原则

本次改造只解决两个问题：

1. 一个 Provider 可以配置多个模型。
2. 用户可以决定哪些模型进入现有模型选择器。

Provider 设置页、默认模型设置、会话选择器、视觉设置和记忆设置继续使用当前布局。前端不增加新的页面层级和大范围交互模式。

### 保留与删除

保留以下内容：

- `ProviderConfig.models[]`。
- `{ providerId, modelId }` 作为模型引用。
- 手动添加模型。
- 从 Provider 获取模型列表。
- 模型启用状态。
- Pi 按当前模型生成运行时配置。
- Claude runtime 将当前模型映射到全部角色变量。
- 请求模型不存在时返回错误，不回退到其他模型。

以下内容退出本次 Feature：

- Provider 独立详情页和“模型 / 连接设置”页签。
- 模型目录表格、状态中心和“需要处理”筛选。
- 收藏和最近使用。
- 新的 400px 搜索模型弹层。
- 默认、视觉和记忆选择器的整体重建。
- 模型级 Base URL、凭据、Headers 和协议覆盖。
- OpenAI Responses 与 Google API 类型扩展。
- 模型能力编辑页面。
- `compat` 编辑页面。
- 模型测试历史、最后发现时间和 tombstone 管理界面。
- Provider 凭据类型的同步重构。
- 自动路由、计费展示和组织策略。

### 数据模型

Provider 保留现有连接字段，并将单个 `modelId` 和四个 `roleModels` 替换为 `models[]`：

```ts
interface ProviderConfig {
  id: string
  name: string
  providerType: ProviderType
  baseUrl: string
  apiKey: string
  presetId?: ProviderPresetId
  protocol?: ProviderProtocol
  enabled: boolean
  models: ProviderModel[]
  createdAt: number
  updatedAt: number
}

interface ProviderModel {
  // 发送给上游的精确模型 ID，在单个 Provider 内唯一。
  id: string

  // 可选显示名称，默认显示 id。
  name?: string

  // 是否进入默认、会话、视觉、记忆和子任务的模型选择列表。
  enabled: boolean

  // Pi catalog 无法识别时使用的可选模型级元数据。
  contextWindow?: number
  maxTokens?: number
}

type ModelTarget = {
  providerId: string
  modelId: string
}
```

`ProviderConfig.modelId`、`ProviderConfig.roleModels` 和 Provider 级 `contextWindow` 删除。`ProviderProtocol` 首个版本继续使用当前支持的 `anthropic-messages` 与 `openai-completions`。

`ProviderConfig.isDefault` 删除。默认模型继续保存在默认模型设置中，字段可保持现有 `defaultProviderId + defaultModelId`，本次不强制重写为嵌套对象。

### 模型启用语义

Provider 与模型分别有一个启用状态：

| 状态 | 作用 |
| --- | --- |
| `ProviderConfig.enabled` | 控制整个连接是否可用于新运行和已有会话。 |
| `ProviderModel.enabled` | 控制模型是否进入新目标选择列表。 |

关闭模型启用状态后：

- 默认、会话、视觉、记忆和子任务的选择器不再展示该模型。
- 已经锁定该模型的历史会话继续保留原 `ModelTarget`，运行时仍按该模型执行。
- Provider 整体停用时，历史会话也停止运行并提示 Provider 已停用。

首个版本不提供单独删除模型。用户通过取消启用隐藏模型，避免产生历史会话悬空引用。

### 模型获取与合并

模型获取只用于补充当前 Provider 的可用模型列表。首个版本采用追加式合并：

| 情况 | 结果 |
| --- | --- |
| 获取结果包含已有模型 ID | 保留当前名称和启用状态；仅补充当前为空的显示名称。 |
| 获取结果包含新模型 ID | 添加为 `enabled: false`。 |
| 本次结果缺少旧模型 | 保留旧模型，不删除、不改变启用状态。 |
| 手动模型不在获取结果中 | 保留。 |
| 获取失败 | 保留当前全部模型。 |

追加式合并不需要维护目录缺失、tombstone、字段来源和刷新删除规则。用户可以继续使用上游列表暂时未返回的模型，也可以自行取消启用。

### 前端最小改动

设置侧边栏、模型配置首页、默认模型区域和 Provider 列表保持当前结构。Provider 卡片继续打开现有添加或编辑弹窗。

页面术语固定如下：

| 文案 | 含义 |
| --- | --- |
| 启用此配置 | 启用整个 Provider 连接。 |
| 已启用模型 | 会进入默认、会话、视觉、记忆和子任务选择器的模型。 |
| 可用模型 | 已经添加到当前 Provider，但尚未进入选择器的模型。 |
| 手动添加 | 输入一个 Provider 未通过目录接口返回的模型 ID。 |
| 从 Provider 获取 | 读取 Provider 的模型列表并追加到可用模型。 |

界面不使用“配置模型”作为模型行操作，因为该文案无法区分添加模型和启用模型。模型行只使用“启用”和“取消启用”。

现有弹窗的连接字段保持不变：

1. 配置名称。
2. 服务预设。
3. 接口协议。
4. Base URL。
5. API Key。
6. 启用此配置。
7. 测试连接。

原来的默认模型和四个 Claude 角色模型输入区域替换为以下两个区域：

#### 已启用模型

显示 `models.filter(model => model.enabled)`。每行显示模型名称和模型 ID，并提供“取消启用”。没有已启用模型时显示：“还没有启用任何模型，从下方可用模型中选择。”

#### 可用模型

显示 `models.filter(model => !model.enabled)`，每行提供“启用”。区域顶部保留两个操作：

- “从 Provider 获取”，使用当前表单中的协议、Base URL 和 API Key 请求模型列表。
- 手动添加，输入模型 ID 和可选显示名称。

手动添加成功后直接进入“已启用模型”。从 Provider 获取的新模型进入“可用模型”，由用户逐项启用。

如果 Provider 返回的模型较多，可用模型区域提供一个本地过滤输入框。该输入框只匹配显示名称和模型 ID，不引入新的全局搜索交互。

创建和保存按钮沿用当前弹窗位置。至少有一个已启用模型后才允许创建或保存已启用的 Provider。Provider 本身关闭时可以保存零个已启用模型。

### 其他前端位置

本次只修改以下数据来源：

| 位置 | 当前来源 | 新来源 |
| --- | --- | --- |
| Provider 卡片模型数量 | `modelId + roleModels` 去重 | `models.filter(enabled)` 数量 |
| 默认模型下拉 | `modelId + roleModels` | 所有已启用 Provider 下的已启用模型 |
| 会话模型下拉 | `modelId + roleModels` | 当前可选 Provider 下的已启用模型 |
| 视觉模型下拉 | `modelId + roleModels` | 已启用模型，再沿用当前视觉能力判断 |
| 记忆模型下拉 | `modelId + roleModels` | 已启用模型 |
| 子任务模型列表 | `modelId + roleModels` | 已启用模型 |

现有 `AgentSettingsSelector` 的触发器、二级菜单、推理强度区域和 Provider 锁定行为保持不变。本次不增加收藏、最近使用和搜索弹层。用户主动启用的模型通常是 Provider 完整目录的子集，现有选择器可以继续承担选择任务。

默认模型、视觉和记忆页面继续使用当前下拉菜单。各页面调用同一个 `getEnabledProviderModels(provider)` 纯函数生成模型选项，避免重复启用过滤逻辑。

### 前端状态

新增状态限制在 Provider 编辑弹窗内部：

| 状态 | 表现 |
| --- | --- |
| 正在获取模型 | “从 Provider 获取”按钮显示进度并禁止重复点击。 |
| 获取失败 | 可用模型区域显示错误和重试；当前模型列表保持不变。 |
| 获取成功 | 新模型追加到可用模型区域。 |
| 手动输入重复模型 ID | 显示“该模型已存在”，不重复添加。 |
| 没有已启用模型 | 已启用模型区域显示空状态，启用的 Provider 不能保存。 |
| 测试连接中 | 沿用当前连接测试状态和取消能力。 |

模型获取、手动添加、启用和取消启用都先修改当前弹窗草稿。用户点击“创建”或“保存”后统一写入 Provider，关闭弹窗时不保存草稿。

### 运行时目标解析

默认模型、会话、视觉、记忆和子任务继续使用 `{ providerId, modelId }`。共享解析函数只负责查找明确目标：

```ts
resolveProviderModel(
  provider: ProviderConfig,
  requestedModelId: string
): ProviderModel | null
```

请求模型不存在时返回 `null`。当前 `resolveProviderModelId()` 回退到 Provider 第一个模型的行为删除。

为新会话、默认模型、视觉、记忆和子任务选择模型时，只接受 `enabled: true`。解析已经锁定的历史会话时允许 `enabled: false`，保证用户取消启用后不影响原会话。

### Pi runtime

Pi 执行路径保持当前形态，只将模型元数据来源从 Provider 级字段调整为当前 `ProviderModel`：

```text
Session providerId + selectedModelId
  -> ProviderConfig + ProviderModel
  -> buildPiProvider()
  -> ModelRuntime.registerProvider()
  -> getModel(providerId, modelId)
```

模型的 `contextWindow` 和 `maxTokens` 优先使用 `ProviderModel` 值；缺失时继续使用 Pi catalog 和现有保守默认值。会话最大输出量不能超过模型 `maxTokens`。

本次不扩展 Pi API 类型，不增加模型级协议、Base URL 和 `compat` 配置页面。

### Claude runtime

Provider 页面删除 `roleModels`。Claude Adapter 将当前用户选择的 `ModelTarget.modelId` 同时写入：

```text
ANTHROPIC_MODEL
ANTHROPIC_DEFAULT_SONNET_MODEL
ANTHROPIC_DEFAULT_OPUS_MODEL
ANTHROPIC_DEFAULT_HAIKU_MODEL
ANTHROPIC_SMALL_FAST_MODEL
```

Claude SDK 的主 Agent、Explore、Plan、快速任务和压缩均使用当前模型。角色模型映射只存在于 Claude Adapter。

### 配置切换

最终实现不保留 `modelId`、`roleModels`、Provider 级 `contextWindow` 和 `isDefault` 的长期读取路径。旧数组配置在读取边界一次性迁移为版本 2，迁移成功后原子写回；运行时代码只读取 `models[]`。迁移依据与历史证据见 [Proma Provider 模型迁移调研](./proma-provider-model-migration-history-2026-08-21.md)。

## 实施顺序与验证

### 切片一：手动多模型端到端

1. 引入 `ProviderModel[]`，改造持久化和共享模型解析函数。
2. Provider 弹窗将旧模型字段替换为“已启用模型”和“可用模型”。
3. 支持手动添加、启用和取消启用。
4. 默认、会话、视觉、记忆和子任务选择器改为读取已启用模型。
5. Pi 和 Claude runtime 改为读取当前 `ProviderModel`。
6. L3 验证同一 Provider 手动添加两个模型，只启用其中一个，并完成真实 Agent 工具调用。

### 切片二：从 Provider 获取模型

1. 实现当前协议支持的模型列表获取。
2. 实现追加式合并和重复 ID 处理。
3. Provider 弹窗增加获取进度、错误和本地过滤。
4. Live SDK 验证真实 Provider 模型列表获取。

### 测试范围

| 层级 | 覆盖内容 |
| --- | --- |
| L1 | 模型 ID 去重、追加式合并、已启用模型过滤、严格目标解析、Pi 模型编译、Claude 环境变量映射。 |
| L2 | Provider 保存与加载、多模型启用状态、默认模型持久化、历史会话使用已取消启用模型、获取失败保留当前列表。 |
| L3 | 保持当前 Provider 弹窗布局，添加两个模型、启用其中一个、保存后只在现有选择器看到已启用模型，并完成真实工具调用。 |
| Live SDK | 模型列表获取、当前两个协议的单模型调用和 Pi 动态注册。 |

### 前端验收条件

- Provider 添加和编辑继续使用当前弹窗。
- 连接字段、启用配置、测试连接和创建或保存按钮位置保持不变。
- 默认模型和四个 Claude 角色输入框被“已启用模型”和“可用模型”替换。
- 手动添加模型只要求模型 ID，显示名称可选。
- 手动模型添加后立即进入已启用模型。
- 从 Provider 获取的新模型默认进入可用模型。
- 模型可以在已启用和可用两个区域之间切换。
- Provider 卡片、默认模型、会话、视觉、记忆和子任务只展示已启用模型。
- 取消启用模型后，历史会话继续使用原模型。
- 获取模型失败时当前列表不丢失。
- 会话模型选择器的布局和交互保持当前状态。

## 证据与限制

| 来源 | 用途 |
| --- | --- |
| [Proma `channel.ts`，提交 `447169c`](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/packages/shared/src/types/channel.ts#L262-L326) | Provider 连接携带多模型目录的持久化结构。 |
| [Proma `ChannelForm.tsx`](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/renderer/components/settings/ChannelForm.tsx#L639-L681) | 发现结果、手动模型和启用状态的合并规则。 |
| [Proma `ModelSelector.tsx`](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/renderer/components/chat/ModelSelector.tsx#L39-L243) | Provider 分组、搜索、会话级二元模型身份。 |
| [Proma `pi-model-registry.ts`](https://github.com/proma-ai/Proma/blob/447169c791c4421c3e9618a45e1f2f3879b08282/apps/electron/src/main/lib/adapters/pi-model-registry.ts#L731-L776) | 按当前选择构建动态 Pi Provider 与模型定义。 |
| [本地 Pi Custom Models 文档](/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/docs/models.md) | 项目锁定 Pi 版本的 Provider 默认值、API 类型和模型级元数据合同。 |
| [本地 Pi Custom Provider 文档](/Users/bytedance/Desktop/03-code/ZoraAgent/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md) | 项目锁定 Pi 版本的动态 Provider 注册合同。 |
| [VS Code 模型管理文档](https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/language-models.md) | Provider 分组、可见性、置顶、能力过滤、BYOK 与模型级配置。 |
| [VS Code Language Models 源码](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/languageModels.ts#L3219-L3335) | 最近使用、固定置顶和隐藏模型状态的独立管理。 |

Proma 的 Channel 名称、预设清单和订阅登录流程服务于其产品范围，不能直接作为 Zora 的 Provider 类型设计。VS Code 的自动路由、组织策略与计费模型同样不在当前范围。当前设计只采用 Provider 与模型分层、目录管理和选择器交互。
