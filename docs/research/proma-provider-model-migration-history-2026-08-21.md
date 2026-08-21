# Proma Provider、Channel 与模型配置变更历史

状态：调研完成

日期：2026-08-21

## 结论

Proma 没有经历过 Channel 从单个 `modelId` 迁移到 `models[]`。Channel 模块首次进入仓库时，持久化结构已经是 `Channel.models: ChannelModel[]`。因此，Proma 不能直接证明单模型字段删除并改为数组时应采用哪一种迁移映射。

Proma 存在多组与本次体验风险相近的一手案例：

1. 飞书和钉钉配置从单 Bot 变为 `bots[]` 时，Proma 使用 v1 到 v2 的读取时迁移，原凭据和启用状态进入数组首项，并立即写回新结构。
2. Channel 持久化字段的语义发生变化时，Proma 使用配置版本、读取时一次性迁移、按旧版本实际运行结果转换、首次读取后持久化，并为纯迁移函数补幂等和边界测试。
3. 模型 ID 在多个 Channel 中重名后，Proma 将模型目标定义为 `channelId + modelId`，候选按 Channel 分组，显式目标必须属于对应 Channel 且已启用。跨 Channel 时不继承父 Channel 的模型 ID。
4. 新模型候选需要进入存量 Channel 时，Proma 将 schema migration 与一次性 preset update 分开。新增模型默认禁用，并记录已应用的 update ID，避免每次启动重新补回用户删除的模型。
5. Provider 合并或默认值改名时，Proma 只自动迁移能够证明仍为旧默认值的配置。用户自定义 URL 和名称保留。旧 Provider 在新建入口隐藏后，编辑历史 Channel 时仍动态补入下拉选项。
6. 模型刷新曾将失败结果当成空目录，可能由自动保存写入空模型列表。后续提交改为只有刷新成功才更新模型目录，失败时保留全部现有模型。
7. Proma 上游为委派工具增加 `modelId` 时采用了可选字段和继承语义，没有直接替换已有输入或输出结构。本地未上游提交 `447169c7` 随后将单 Channel 输出改为 `channels[].models[]`，该改动缺少兼容输出，不能作为 Proma 上游的兼容先例。

对 Zora 更合适的兼容设计是一次性存储迁移：读取旧 Provider 配置时，将 `modelId`、去重后的 `roleModels` 和 Provider 级 `contextWindow` 编译为 `models[]`，写入新版本后删除旧字段。运行时和会话引用统一使用 `{ providerId, modelId }`，不再保留长期兼容分支。模型获取失败时不得修改本地目录；同名模型必须按 Provider 精确解析。

## 调研范围与分支说明

本次只使用本地 Proma 仓库的一手资料：`git log`、`git show`、`git blame`、源码和测试。

- 仓库：`/Users/bytedance/Desktop/03-code/github_ref/Proma`
- 当前工作树：`447169c791c4421c3e9618a45e1f2f3879b08282`
- 本地 `origin/main`：`65c914ae802d515ce5c2ff04e9264c907fb3a5c7`
- 历史搜索覆盖 `--all`。当前工作树和 `origin/main` 已分叉，因此下文分别标注当前工作树、本地提交和上游提交。
- 历史文件的绝对路径指向仓库中的逻辑位置。文件在当前工作树不存在或内容不同的地方，以 `git show <commit>:<path>` 中的版本为准。

确认程度定义：

| 确认程度 | 含义 |
| --- | --- |
| 高 | 提交说明、源码和测试或后续源码相互印证。 |
| 中 | 提交与源码能够确认行为，但缺少专项测试或用户侧结果。 |
| 结论待定 | 只能确认代码变更，无法从仓库判断真实用户影响或上游服务行为。 |

## 1. Channel 从首次提交起就是 `models[]`

### 证据

Channel 模块由提交 `64f738d363284b7162a95a75b0315cb3d4d908ab` 于 2026-02-06 首次引入。其父提交没有以下 Channel 文件。首次版本已经包含：

```ts
export interface Channel {
  id: string
  name: string
  provider: ProviderType
  baseUrl: string
  apiKey: string
  models: ChannelModel[]
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface ChannelCreateInput {
  // ...
  models: ChannelModel[]
}

export interface ChannelUpdateInput {
  // ...
  models?: ChannelModel[]
}
```

一手资料：

- 绝对路径：`/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/channel.ts`
- 首次引入提交：`64f738d363284b7162a95a75b0315cb3d4d908ab`
- 主进程持久化入口：`/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts`
- 同一提交：`64f738d363284b7162a95a75b0315cb3d4d908ab`

`git log --follow` 显示 `channel.ts` 的历史起点就是该提交；对 Channel 类型执行 `git log -S'modelId: string'` 和 `git log -S'model: string'` 未发现单模型持久化字段被替换的提交。

### 判断

Proma 没有单模型到 `models[]` 的直接迁移经验。把 Proma 当前数据模型当作 Zora 的目标结构是合理的；把它当作历史配置迁移方案缺少证据。

确认程度：高。

## 2. 单配置迁移为数组的直接案例

Proma 的 Channel 从首次提交起已经是 `models[]`，但飞书与钉钉配置经历了更接近 Zora 的结构变化：一个旧配置对象迁移为多个 Bot 的数组。

飞书提交 `c53a48c80f5afda965ba97e2536a4cd7be316973` 于 2026-04-02 引入多 Bot：

- v2 格式定义为 `{ version: 2, bots: [...] }`。
- 读取到旧格式时，把原 `appId`、加密后的 `appSecret`、`enabled` 和默认工作区原样放入一个新 Bot。
- 新 Bot 只补充旧结构不存在的 `id` 和默认名称。
- 转换后立即写回同一个配置文件，后续读取只消费 v2。
- 原有单 Bot API 继续作为 deprecated 包装器，委托到 `bots[0]`。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/feishu-config.ts:51-100`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/feishu.ts`
- 提交：`c53a48c80f5afda965ba97e2536a4cd7be316973`

钉钉提交 `18a91a95e5e45f04501ad768783a66cea6fb430f` 同日采用相同设计，并进一步使用稳定 Bot ID 和原子写入：

- 旧 `clientId`、加密后的 `clientSecret`、`enabled` 和默认工作区进入 `bots[0]`。
- 读取旧格式后通过 `writeJsonFileAtomic()` 写回 v2。
- v2 中发现不稳定 ID 时，同样在读取边界规范化并原子回写。
- 原有单 Bot API 暂时保留为 deprecated 包装器。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/dingtalk-config.ts:126-176`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/dingtalk.ts`
- 提交：`18a91a95e5e45f04501ad768783a66cea6fb430f`

确认程度：高。

### 对 Zora 的含义

这两个提交直接支持把旧 Provider 模型字段编译为一个新数组，并在读取边界完成写回。Proma 同时保留旧 API，是因为飞书和钉钉有多组仍在调用单 Bot 函数的内部模块。Zora 的 Provider API、IPC、Renderer 和 Runtime 可以在同一 Feature 中原子更新，因此没有必要复制这部分长期包装器。适合保留的是存储层一次性迁移，业务层只使用 `models[]`。

## 3. 模型身份从 `modelId` 扩展为 `channelId + modelId`

### 3.1 上游先采用可选 `modelId`，省略时继承

提交 `1d562690028fb3a38c3ee97e3fbc14fc762a5f2f` 于 2026-06-25 为协作子 Agent 增加模型选择：

- `delegate_agent` 和 `delegate_agents.items[]` 增加可选 `modelId`。
- 未传 `modelId` 时继承父会话当前模型。
- 显式传入时，校验模型属于父会话当前 Channel 且已启用。
- 委派记录和恢复路径持久化 `channelId` 与 `modelId`。
- 历史记录缺少模型时，恢复逻辑使用 `session.modelId ?? fallbackModelId`。
- 工具结果新增 `effectiveModelId`，没有删除既有结果字段。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-collaboration-tools.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-model-selection.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-session-manager.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/agent.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/default-skills/agent-collaboration/SKILL.md`
- 提交：`1d562690028fb3a38c3ee97e3fbc14fc762a5f2f`

该提交没有新增专项测试。输入兼容和恢复语义可以由提交 diff 直接确认。

确认程度：高。

### 3.2 本地提交将跨 Channel 目标改为二元身份

当前工作树提交 `447169c791c4421c3e9618a45e1f2f3879b08282` 进一步允许子 Agent 跨 Channel 选择模型。实现明确写出模型 ID 可能在多个 Channel 重名，目标解析必须保留两部分身份：

- 候选输出由单个 Channel 的顶层 `models[]` 改为按 Channel 分组的 `channels[].models[]`。
- 委派输入新增可选 `channelId`。
- 指定 `channelId + modelId` 时，模型必须属于该 Channel 且已启用。
- 指定其他 Channel 且省略 `modelId` 时，不继承父会话模型 ID，交给目标 Channel 的默认选择。
- 同一 Channel 且省略 `channelId` 时，保留父 Channel 与父模型继承语义。
- 结果返回 `effectiveChannelId`、`effectiveChannelName`、`effectiveModelId` 和 `crossChannel`。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-delegation-target.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-model-selection.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-collaboration-tools.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-delegation-target.test.ts`
- 提交：`447169c791c4421c3e9618a45e1f2f3879b08282`

测试覆盖：

- `glm-5.2` 同时存在于 Proma 官方 Channel 和火山 Channel 时，可由 `channelId` 精确定位。
- 目标 Channel 停用、缺失或模型未启用时明确报错。
- 跨 Channel 且未指定模型时不继承父模型。
- 候选列表过滤停用 Channel 和停用模型。

这个提交不在本地 `origin/main` 的祖先链上。它能证明本地 Proma 分支针对重名模型采用了二元身份，也说明将工具结果从顶层 `models[]` 直接改为 `channels[].models[]` 会改变工具契约。提交本身没有保留旧顶层字段，不能证明旧 Agent 或旧 Skill 调用体验已经兼容。

确认程度：高；兼容效果：结论待定。

### 3.3 历史消息曾因缺少 Channel 身份显示错误

上游历史提交 `90d2bba059b8d9b903dfc6225209ae8f171274ec` 于 2026-08-14 修复了一个更直接的体验问题：历史消息只有模型 ID 时，跨 Channel 重名模型可能解析到错误别名、Provider 和 Logo。

当时的解决方式是：

- assistant 和 result 消息持久化 `_channelId`。
- partial frame、空响应错误、类型化错误和外部运行事件都携带运行开始时的 Channel 身份。
- 显示名和 Provider 解析优先限定到 `_channelId` 对应 Channel。
- 旧消息没有 `_channelId` 时继续使用全 Channel 搜索作为显示 fallback。
- 消息分组缓存把 `channelId` 纳入复用条件，避免同模型、不同 Channel 的 Header 被错误复用。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-message-channel-identity.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-message-channel-identity.test.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/lib/model-logo.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/lib/model-logo.test.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/message-group-rendering.test.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/session-core/src/session-core.test.ts`
- 修复提交：`90d2bba059b8d9b903dfc6225209ae8f171274ec`

随后提交 `d1338c952852c6356b74da460d3b03b8dfe65cf2` 为恢复 v0.17.26 baseline 删除了这组实现与测试。当前工作树也不包含 `_channelId` 消息字段。该事实不否定问题曾发生，只说明这项修复没有保留在当前基线中。

确认程度：高。

### 对 Zora 的含义

以下位置应统一保存 `{ providerId, modelId }`，仅存 `modelId` 会重复 Proma 已确认的问题：

- 默认模型。
- 会话模型。
- 历史消息的实际运行模型。
- 视觉、记忆和子任务目标。
- 运行中消息快照。

历史记录如果只有 `modelId` 且多个 Provider 均含该 ID，无法可靠自动判断原 Provider。应保留原始 ID并标记目标不完整，或只在候选唯一时补全。不能按 Provider 列表顺序选择第一个匹配项。

## 4. Channel 字段语义变化采用版本化一次性迁移

提交 `ce55e01e747aa1b35bbc30920ecab0f9b2e406fb` 于 2026-06-28 改变了 `custom` 和 `anthropic-compatible` 的 `baseUrl` 语义：旧版本存协议根地址并由运行时追加端点，新版本把存储值当作完整请求地址。如果只更新运行时代码，历史配置会向缺少端点后缀的地址发请求。

Proma 的处理方式：

1. `CONFIG_VERSION` 从 1 升至 2。
2. `readConfig()` 将缺失版本按 v1 处理。
3. `migrateConfig()` 只处理受影响 Provider。
4. 转换结果以旧版本实际请求过的完整 URL 为不变量：
   - `custom` 补 `/chat/completions`。
   - `anthropic-compatible` 补 `/v1/messages`。
5. 已是完整端点、空值和其他 Provider 保持不变。
6. 首次读取后回写 v2 配置。
7. 迁移函数保持幂等。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/core/src/providers/url-utils.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/core/src/providers/url-utils.test.ts`
- 提交：`ce55e01e747aa1b35bbc30920ecab0f9b2e406fb`

测试覆盖 `custom`、`anthropic-compatible`、空值、非目标 Provider、完整端点幂等，以及迁移后的 Anthropic 地址仍可被旧 SDK 路径还原成相同根地址。

确认程度：高。

### 对 Zora 的含义

Provider 单模型字段改为 `models[]` 也属于持久化语义变化。适合采用同一模式：

- 配置文件增加明确版本。
- 只在 Provider Manager 读取边界做一次迁移。
- 迁移目标以旧版本可选择和实际运行的模型集合为不变量。
- 成功后使用原子写回。
- 新代码只消费 `models[]`，不在业务层散布 `modelId ?? models[0]` 之类的长期兼容判断。

## 5. 新模型候选与 schema migration 分开

提交 `28ca96a56828f23d0c08b9222569479eb007ee6c` 于 2026-08-17 为历史 Channel 增加 GLM-5.3 候选。它没有继续增加 `CONFIG_VERSION`，而是新增独立的 `appliedPresetModelUpdates?: string[]`：

- 每个 preset update 有固定 ID，例如 `glm-5.3-candidates-v1`。
- 只向匹配 Provider 的存量 `channel.models` 追加缺失 ID。
- 新候选默认 `enabled: false`。
- 应用后记录 update ID。
- 后续启动不重复应用，避免把用户删除过的模型再次补回。
- 同一提交将 Channel 配置写入改为 `writeJsonFileAtomic()`。

提交 `65c914ae802d515ce5c2ff04e9264c907fb3a5c7` 于 2026-08-21 沿用该机制，为 DeepSeek 增加视觉候选。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/channel.ts`
- 引入提交：`28ca96a56828f23d0c08b9222569479eb007ee6c`
- 后续提交：`65c914ae802d515ce5c2ff04e9264c907fb3a5c7`

仓库未发现 `applyPresetModelCandidateUpdates` 的专项测试。

确认程度：高；回归验证完整度：中。

### 对 Zora 的含义

结构迁移和目录更新应分别处理：

- `modelId/roleModels/contextWindow -> models[]` 属于 schema migration。
- 产品以后为某个 Provider 增加推荐模型，属于一次性 catalog update。

把两者混为一组 schema 版本会使高版本配置漏掉目录更新，也可能在每次启动覆盖用户的启用状态。

## 6. Provider 合并只迁移可证明为默认值的配置

### 6.1 隐藏旧 Provider，同时允许编辑历史配置

提交 `ea77deb41d2c09462fdc977791f8f6d012c4421f` 于 2026-08-18 合并 Qwen 的新建入口：

- 新建 Provider 下拉隐藏旧 `qwen`。
- `ProviderType`、Label 和运行路径继续保留，历史 Channel 仍可运行。
- 编辑一个使用旧 `qwen` 的 Channel 时，表单把当前 Provider 动态追加到下拉选项，避免 Select 显示 placeholder。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/ChannelForm.tsx`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/channel.ts`
- 提交：`ea77deb41d2c09462fdc977791f8f6d012c4421f`

确认程度：高。

### 6.2 后续只迁移仍使用官方默认端点的配置

提交 `f67163ff86e264f80b50859af2909527ef43e1fa` 于 2026-08-21 将 Channel 配置从 v4 升至 v5：

- 仅当 Provider 为 `qwen-anthropic`，且 `baseUrl` 仍等于旧官方默认值时，转换为 `qwen` 和新的 OpenAI 兼容端点。
- 用户填写的自定义 Anthropic 端点不自动迁移。
- 旧 `qwen-anthropic` 类型与显示名称继续保留，供历史自定义 Channel 使用。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/ChannelForm.tsx`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/channel.ts`
- 提交：`f67163ff86e264f80b50859af2909527ef43e1fa`

确认程度：高。

### 6.3 默认名称变化只更新未自定义的名称

提交 `9084834977151b0ffe0000f89b4479c3527c54ba` 于 2026-08-18 将 Channel 配置从 v2 迁移至 v4。名称迁移都要求当前值与旧默认名称精确相等，例如 `provider === 'ark-coding-plan' && name === '火山方舟 Coding Plan'`。用户自定义名称不修改。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/channel.ts`
- 提交：`9084834977151b0ffe0000f89b4479c3527c54ba`

确认程度：高。

### 对 Zora 的含义

旧字段存在用户自定义含义时，只迁移可以证明等价的值：

- 旧主模型、角色模型都有明确 ID，可以无损进入 `models[]`。
- `contextWindow` 在旧结构中作用于整个 Provider。为了保持旧运行结果，迁移时应复制到每个由旧字段生成的模型条目。不能只给主模型赋值后让角色模型改用新的默认窗口。
- 不存在、为空或冲突的模型字段不应猜测其他模型。
- 无法证明对应关系的历史会话保留原引用并显示不可用状态，由用户显式重选。

## 7. `ChannelModel.source` 使用可选字段做嵌套扩展

提交 `836512f37bad972a8244734f6387be84168aad16` 于 2026-06-16 给 `ChannelModel` 增加：

```ts
source?: 'manual' | 'fetched'
```

它没有配置迁移。手动新增模型写入 `source: 'manual'`；模型刷新时保留手动模型、按 ID 保留旧 `enabled`、新模型默认禁用，并移除成功结果中不存在的非手动模型。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/channel.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/ChannelForm.tsx`
- 提交：`836512f37bad972a8244734f6387be84168aad16`

历史模型没有 `source`，因此不会被视为 `manual`。一次成功刷新后，未出现在供应商结果中的历史模型会被移除。这是代码可确认的行为；仓库没有专项测试证明该行为覆盖了所有历史配置预期。

确认程度：高；历史模型来源推断的产品合理性：中。

## 8. 模型刷新失败曾影响历史模型列表

提交 `836512f37bad972a8244734f6387be84168aad16` 最初把失败结果视为空目录，清除全部非手动模型。由于表单存在自动保存，这可能把空模型列表持久化。

提交 `b47f8a8f2b0bde718db60400c3cb117c3eebce92` 于 2026-07-06 修正为：

- `result.success === false` 时立即返回，现有模型不变。
- IPC 异常只更新错误状态，不再清空模型。
- 只有成功结果才作为权威目录合并。

当前工作树仍保留这项行为：成功刷新保留手动模型和旧启用状态，新模型默认禁用；失败刷新保留全部模型。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/ChannelForm.tsx`
- 引入问题的提交：`836512f37bad972a8244734f6387be84168aad16`
- 修复提交：`b47f8a8f2b0bde718db60400c3cb117c3eebce92`

仓库未发现这段目录合并逻辑的专项测试。

确认程度：高；回归验证完整度：中。

### 对 Zora 的含义

模型发现属于外部 I/O，失败不能被解释为零模型。保存 Provider 草稿和刷新模型目录也应保持事务边界：

- 失败时保持 `models[]` 完全不变。
- 成功时按 ID 合并。
- 已有条目保留 `enabled` 和用户编辑的元数据。
- 新条目默认禁用。
- 首个版本若不提供明确删除语义，供应商本次未返回的旧条目继续保留。

最后一条比 Proma 当前的成功刷新权威替换更保守，属于针对 Zora 历史会话引用的设计推导。

## 9. 可选字段补齐历史会话模型选择

提交 `3d4cfc0ad907f3bcb04f4326d4ed5c332a6936e6` 于 2026-06-15 修复自动任务子会话打开后模型选择器为空：创建子会话时只持久化 `channelId`，没有持久化 `modelId`。

解决方式：

- `AgentSessionMeta` 增加可选 `modelId?: string`。
- 创建自动任务子会话时写入 `automation.modelId`。
- UI 初始化时优先使用会话 `channelId/modelId`，缺失时回退全局默认。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/agent.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-session-manager.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/automation-scheduler.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/agent/AgentView.tsx`
- 提交：`3d4cfc0ad907f3bcb04f4326d4ed5c332a6936e6`

该提交没有专项测试。

确认程度：高。

这个案例支持添加可选字段并在读取边界使用明确 fallback。它不支持在新结构稳定后长期保留两套 Provider 字段。

## 10. 无法互操作的历史数据保留可读性

提交 `ebfd3a588863d2403e52b902cc880542a486bcb6` 于 2026-08-08 将 Agent runtime 切为 Pi-only。Claude session artifact 不能直接交给 Pi 恢复，Proma 没有静默重解释：

- Agent session index 从 v1 升至 v2。
- 历史 Claude 会话迁移为 `legacyTranscript: { sourceRuntime: 'claude', continuationRequired: true }`。
- 清除 `sdkSessionId`、Pi artifact、entry bindings 和 Claude fork/rewind 元数据。
- 历史 transcript 保持可读。
- fork 和 rewind 明确拒绝只读历史会话。
- 新 Pi-only 记录缺少 runtime 字段时不再被误判为 Claude；只有旧 index 版本的缺失字段才按历史 Claude 处理。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-session-manager.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/agent-session-manager.test.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/agent.ts`
- 提交：`ebfd3a588863d2403e52b902cc880542a486bcb6`

测试覆盖显式 `agentRuntime: 'claude'` 和旧 index 中缺失 runtime 的会话，断言迁移后 transcript 可识别、运行 artifact 被清除、fork/rewind 被拒绝。

确认程度：高。

### 对 Zora 的含义

如果某个历史 Provider 或会话无法无损映射到新模型目录，应保留可读配置和原始目标，明确显示需要重新选择。静默切换到第一个可用模型会改变费用、能力和请求协议，也会掩盖迁移失败。

## 11. 风险反例

提交 `be9a7d8b802c43983a5544be0bf484782f31dc3b` 于 2026-08-18 把 Kimi API 预设和测试模型 ID 从 `k3` 改为 `kimi-k3`。该提交没有迁移现有 `channels[].models[].id`，后续历史中也未找到针对旧 `k3` 的配置迁移。

一手资料：

- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/main/lib/channel-manager.ts`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/apps/electron/src/renderer/components/settings/ChannelForm.tsx`
- `/Users/bytedance/Desktop/03-code/github_ref/Proma/packages/shared/src/types/channel.ts`
- 提交：`be9a7d8b802c43983a5544be0bf484782f31dc3b`

仓库只能确认旧模型 ID 没有被代码迁移。`k3` 是否仍被上游接受，以及用户是否受到调用失败影响，原因未查明。

确认程度：结论待定。

这个反例说明模型 ID 改名应被视为持久化引用迁移，不能只改预设常量和显示表单。

## Zora 兼容设计建议

### A. Provider 配置一次性迁移

建议新增配置版本，例如 v1 为现有结构，v2 为 `models[]`。读取 v1 时：

1. 按固定顺序收集旧模型 ID：`modelId` 在前，随后是 `roleModels` 中各字段。
2. 去除空值，并按模型 ID 稳定去重。
3. 每个旧模型生成一个 `ProviderModel`，`enabled: true`。
4. 旧 `contextWindow` 存在时复制到每个迁移出的模型，保持旧 Provider 级运行语义。
5. 名称缺少可靠来源时使用模型 ID，不推断品牌名称。
6. 保存新 `models[]`，删除 `modelId`、`roleModels` 和 Provider 级 `contextWindow`。
7. 只有迁移和完整校验成功后使用原子写回。
8. 再次读取 v2 不产生任何变化。

这是短期 migration，不需要在 Provider、选择器和 runtime 中长期保留旧字段读取分支。

### B. 模型引用使用二元身份

所有运行目标和历史引用统一为：

```ts
interface ModelTarget {
  providerId: string
  modelId: string
}
```

解析规则：

- Provider 不存在或停用时返回明确错误。
- 模型不存在时返回明确错误。
- 不按名称、Provider 类型或数组首项回退。
- 多个 Provider 包含相同 `modelId` 时必须依赖 `providerId`。
- 历史引用只有 `modelId` 时，仅在全局候选唯一的情况下允许一次性补全；其余情况要求用户选择。

### C. 工具或 IPC 契约的兼容选择

Proma 上游提交 `1d562690` 的模式是增加 optional 字段和新增结果字段。当前本地提交 `447169c7` 直接把顶层 `models[]` 改为 `channels[].models[]`，会改变旧调用方读取路径。

如果 Zora 的工具契约可能被当前 Agent、Skill 或历史自动任务继续调用，可采用一次发布周期的加法结构：

```ts
interface ModelCatalogResult {
  // 当前 Provider 视图，供旧调用方读取。
  providerId: string
  models: ProviderModel[]

  // 新调用方使用的完整目录。
  providers: Array<{
    providerId: string
    providerName: string
    models: ProviderModel[]
  }>
}
```

输入新增 `providerId?: string`；省略时使用当前 Provider，显式传入时与 `modelId` 成对校验。所有内置 Prompt、Skill 和调用方切换完成后，可以在后续明确版本中删除旧视图。

如果该接口没有持久化调用者，并且所有调用方能在同一提交原子更新，直接切换新结构更符合 Zora 当前不保留兼容层的工程原则。两种情况需要在实施前确认调用边界。

### D. 模型发现合并规则

建议采用：

| 场景 | 结果 |
| --- | --- |
| 获取失败 | `models[]` 完全不变。 |
| 获取到已有 ID | 保留 `enabled` 和用户元数据，只补充缺失的目录元数据。 |
| 获取到新 ID | 追加为 `enabled: false`。 |
| 本次未返回旧 ID | 保留，避免历史会话悬空。 |
| 手动模型不在结果中 | 保留。 |

Proma 已证实失败清空目录会影响自动保存；Zora 保留本次未返回的旧 ID 是更保守的设计，用于保护历史会话引用。

## 必要测试

### 配置迁移

- 无 `version` 的旧配置按 v1 迁移。
- 只有主模型。
- 主模型与角色模型重复。
- 部分角色模型为空。
- Provider 关闭时仍保留模型目录和启用状态。
- `contextWindow` 复制到全部迁移模型。
- v2 重读幂等。
- 迁移失败不覆盖原文件。
- 原子写入后重启可读取。

### 模型身份

- 两个 Provider 包含同一个 `modelId`，可按 `providerId` 精确解析。
- Provider 缺失、停用、模型缺失、模型停用均返回对应错误。
- 历史会话迁移后仍指向同一 `{ providerId, modelId }`。
- 只有 `modelId` 的历史引用在候选唯一时补全，候选不唯一时要求重选。
- 运行中切换下轮模型时，当前消息仍保存本轮 Provider 身份。

### 模型发现

- HTTP 失败、超时和 IPC 异常均不修改目录。
- 成功刷新保留旧启用状态。
- 新模型默认禁用。
- 手动模型保留。
- 上游暂时不返回旧模型时历史引用仍可解析。

## 总结

Proma 没有提供单模型到数组的具体映射代码。其历史提供了四项边界规则：

- 持久化语义变化使用版本化、幂等、一次性迁移，并以旧运行结果为不变量。
- 模型身份必须包含 Provider 或 Channel ID。
- 外部模型发现失败不能修改本地目录。
- 只自动迁移能够证明等价的默认配置，用户自定义值和无法无损转换的历史记录保留并明确提示。

Zora 可以在不保留长期兼容层的前提下兼容历史配置：把兼容逻辑集中在读取时的一次性 migration，迁移完成后全链路只使用 `models[]` 和 `{ providerId, modelId }`。

