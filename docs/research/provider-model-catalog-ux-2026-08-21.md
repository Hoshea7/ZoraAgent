# Provider 多模型配置优化

状态：已实施

更新日期：2026-08-22

## 目标

在现有 Provider 多模型配置基础上完成必要优化：

1. “从 Provider 获取”返回准确的模型列表。
2. “测试连接”并发测试全部已启用模型，并显示逐模型结果。
3. 减少表单中的重复状态和说明文字。

页面结构、运行时协议和模型数据结构保持不变。

## 产品定义

### Provider

Provider 保存服务预设、接口协议、Base URL、API Key 和模型列表。

Provider 的启用状态用于暂停整组连接。该操作属于配置管理，不属于添加和编辑流程：

- 新 Provider 默认启用。
- 添加和编辑弹窗不展示“启用此配置”。
- Provider 卡片提供“停用”和“启用”。
- 停用不修改模型的启用状态。
- 停用后，该 Provider 下的模型不参与新的运行和模型选择。
- 恢复后，原有模型状态继续生效。

Provider 可以在没有已启用模型时保存。此时配置保留，其他模型选择器不展示该 Provider 的模型。

### 模型

- 已启用模型进入默认、会话、视觉、记忆和子任务选择器。
- 取消启用后，模型保留在 Provider 中并进入“可用模型”。
- 手动添加的模型默认启用。
- 从 Provider 获取的新模型默认不启用。

## 用户流程

1. 用户填写连接信息。
2. 用户点击“从 Provider 获取”，或手动添加模型 ID。
3. 用户启用需要使用的模型。
4. 用户可选执行“测试连接”。
5. 用户保存。

测试失败不阻止保存。获取、添加、启用和测试结果在保存前只存在于表单草稿中。

## 前端方案

### 连接信息

保留配置名称、服务预设、接口协议、Base URL 和 API Key。移除“启用此配置”。

### 已启用模型

每行展示模型名称、必要时的模型 ID、测试状态和“取消启用”。测试状态包括“测试中”“连接成功”“连接失败”和“已停止”。

失败原因显示在对应模型行。测试汇总显示在“测试连接”按钮旁，不再使用整行 Provider 级成功提示。

### 可用模型

区域顶部保留一个“从 Provider 获取”按钮。获取成功后直接更新列表，不增加成功说明。

获取失败只显示：

> 获取失败，请手动添加模型。

前端不展示目录来源、更新时间、请求地址、认证方式和解析策略。

模型较多时显示本地筛选。手动添加区保留“模型 ID”“显示名称（可选）”和“添加”，支持 Enter 提交及重复校验。

### Provider 卡片

卡片展示“停用”或“启用”操作。停用后显示“已停用”状态。

## 从 Provider 获取

Renderer 发送统一参数，Provider 差异由主进程处理：

```ts
interface ProviderModelDiscoveryInput {
  presetId: ProviderPresetId
  providerType: ProviderType
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
}
```

主进程按 `presetId` 和已知地址选择模型发现规则，统一返回 `{ id, name? }[]`。

### Provider 规则

| Provider | 模型发现规则 |
| --- | --- |
| Anthropic | Anthropic 模型列表接口和认证格式 |
| OpenAI | 同级 `/models` 和 Bearer 认证 |
| DeepSeek | 服务 origin 下的 `/models` |
| Kimi | 服务 origin 下的 `/v1/models` |
| MiniMax | 服务 origin 下的 `/v1/models` |
| 智谱 | 预设地址对应的 `/models` |
| 火山普通兼容 | 火山兼容接口和组合认证头 |
| 火山 Coding Plan | 内置套餐模型清单 |
| 火山 Agent Plan | 内置套餐模型清单 |
| 自定义兼容接口 | 根据对话地址推导同级 `/models`；已知厂商地址使用对应规则 |

规则借鉴 Proma 的 Provider 分发和 URL 推导，界面仍保持一个“从 Provider 获取”入口。

### 解析和合并

- 忽略缺少 ID 的条目。
- 按精确模型 ID 去重。
- 过滤上游明确标记为不可用或已下线的条目。
- 相同 ID 保留当前启用状态和用户填写的名称。
- 新模型以 `enabled: false` 追加。
- 本次未返回的旧模型和手动模型继续保留。
- 获取失败时不修改当前模型列表。
- 空列表属于成功结果。

API Key 只在主进程使用，不写入日志或错误信息。

## 多模型测试

“测试连接”测试全部已启用模型。没有已启用模型时按钮不可用。

```ts
interface ProviderModelsTestInput {
  baseUrl: string
  apiKey: string
  protocol: ProviderProtocol
  modelIds: string[]
  testRunId: string
}

interface ProviderModelsTestResult {
  success: boolean
  results: Array<{
    modelId: string
    success: boolean
    message: string
  }>
}
```

执行规则：

- Renderer 收集全部已启用模型 ID。
- 主进程使用一个测试任务并发调用每个模型。
- 单个模型失败不停止其他模型。
- 全部通过时汇总结果的 `success` 为 `true`。
- “停止测试”取消尚未完成的全部请求。
- 测试结果仅保存在当前表单状态。
- 修改连接信息或模型状态后清除旧测试结果。

## 运行时规则

所有消费方继续使用 `{ providerId, modelId }`。新运行只接受启用 Provider 下的已启用模型，不自动切换其他 Provider 或模型。

Pi 按当前 `ProviderModel` 构建单次运行模型。Claude Adapter 将用户选择的模型 ID 同时映射到主模型及 Claude 的 Sonnet、Opus、Haiku 和 Small Fast 角色变量，避免第三方兼容端点调用未配置的模型别名。

## 数据模型

继续使用现有 `ProviderConfig.models[]` 和 `ProviderModel.enabled`。本轮不增加目录来源、更新时间、持久化测试状态或模型能力字段。

## 变更范围

已修改：

- Provider 模型发现按预设和厂商分发。
- 新增 MiniMax 预设。
- 批量测试全部已启用模型，并支持统一停止。
- 测试结果显示在模型行。
- Provider 启用操作移到卡片。
- 允许先保存连接信息，再配置模型。
- 手动添加支持 Enter。

保持不变：

- Provider 添加和编辑弹窗的整体结构。
- 已启用模型与可用模型分区。
- 默认、会话、视觉、记忆和子任务选择器布局。
- Pi 和 Claude 的现有运行时接口。

不在本轮范围：

- 独立模型管理页面。
- 模型目录来源和更新时间展示。
- 模型能力、上下文和最大输出编辑。
- 测试历史。
- 自动启用获取结果。
- 自动模型切换和 Provider 回退。
- 更多 Runtime 协议。

## 验收条件

- 添加和编辑弹窗不显示“启用此配置”。
- Provider 卡片可以停用和启用，模型状态保持不变。
- Provider 在没有已启用模型时可以保存。
- “从 Provider 获取”对内置 Provider 使用对应规则。
- 获取成功后模型进入可用模型列表。
- 获取失败后显示简短错误，当前模型列表不变。
- 手动添加默认启用，支持 Enter 和重复校验。
- 测试连接并发测试全部已启用模型。
- 每个模型分别显示测试中、成功、失败或停止。
- 测试失败不阻止保存。
- 新运行不会使用已停用 Provider 或未启用模型。

## 测试覆盖

| 层级 | 覆盖内容 |
| --- | --- |
| L1 | URL 推导、认证头、响应解析、去重、批量测试并发和汇总、空模型 Provider 保存 |
| L2 | Provider 持久化、模型状态、测试取消和类型合同 |
| Live SDK | 真实 Provider 模型连接 |
| L3 | 保存空模型配置、手动添加、Provider 获取、真实 Agent 调用、逐模型测试、停止测试、Provider 停用和启用 |

## 参考

- Proma：`apps/electron/src/main/lib/channel-manager.ts`
- Proma：`packages/core/src/providers/url-utils.ts`
- Zora：`src/main/provider-model-discovery.ts`
- Zora：`src/renderer/components/settings/ProviderSettings.tsx`
- Zora：`src/main/provider-manager.ts`
