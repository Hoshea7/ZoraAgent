# Proma 数据迁移源码调查

调查日期：2026-09-12。直接读取用户提供的本地仓库 `/Users/hoshea/Desktop/code/github_ref/Proma`；工作区干净，固定提交 `f99edbdb594407ab190b97ae073889c5d96637ab`。本文记录已有实现及证据边界，未运行 Proma，也未访问或修改真实用户数据。

## 结论

Proma 提供轻量的迁移入口：复制提示词，让 Agent 创建 ZIP；新设备附上 ZIP，再由 Agent 恢复。迁移页面本身没有实现打包、校验、恢复、目录映射或索引重建引擎。值得参考的是这个用户流程，以及托管资料按当前数据根目录定位、本地项目单独绑定的基础模型。不能直接把页面中的迁移说明当作跨系统恢复已得到验证的证据。

Zora 可以保留这种简单入口，但应由产品保证几项确定行为：坏技能不阻断启动、迁移包真正携带资料、托管资料不依赖旧设备绝对路径、外部目录通过项目编辑重新绑定。Agent 负责解释与组织操作，不必猜测存储结构或逐个替换用户名。这是结合调查作出的设计建议，不是 Proma 已有能力。

## 页面承诺与实际入口

| 项目 | 源码中的真实行为 |
|---|---|
| 创建包 | 静态提示词要求确认范围后，将完整 `.proma` 压成 ZIP，保留原数据；没有规定快照一致性、暂停写入、链接实体化或包清单。 |
| 恢复包 | 静态提示词要求先检查与备份，再解压、按当前版本迁移、重新分配工作区路径、重建索引并检查读取。没有提供这些步骤对应的专用实现。 |
| 页面按钮 | 打开数据文件夹、复制打包提示词、复制恢复提示词。恢复依赖用户把 ZIP 附到对话。 |
| 后端迁移 API | 找到的专用迁移 IPC 只有 `migration:open-data-folder`，调用 `getConfigDir()` 与 `shell.openPath()`。 |

来源：[MigrationSettings.tsx 7–25](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/renderer/components/settings/MigrationSettings.tsx#L7-L25)、[页面交互 27–113](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/renderer/components/settings/MigrationSettings.tsx#L27-L113)、[IPC 5656–5662](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/ipc.ts#L5656-L5662)。另外检索了 Electron 主进程、preload、shared、CLI 和迁移相关文件，没有发现整库 ZIP 迁移专用工具。仓库内其他 migration 函数处理特定版本字段或局部资料升级，不等于跨设备迁移引擎。

## 路径模型

**当前设备的数据根目录动态计算。** `getConfigDir()` 使用 `join(homedir(), getConfigDirName())`；开发环境可能为 `.proma-dev`，正式环境为 `.proma`。页面提示词写的是通常位于 `~/.proma`，没有把实际根目录注入提示词。[config-paths.ts 15–59](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/config-paths.ts#L15-L59)

**部分托管资料使用相对位置或身份定位。** 附件通过相对路径 `{conversationId}/{uuid}.ext` 在当前附件根目录下解析；工作区资料由 slug 推导，会话工作目录由 slug 与 sessionId 推导。这些位置不需要把旧用户名替换为新用户名。[附件 145–151](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/config-paths.ts#L145-L151)、[工作区与会话 376–400](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/config-paths.ts#L376-L400)

**外部项目保留本机绝对路径。** `projectRootPath` 与托管的 `workspace-files` 分开；重新关联时验证新目录，更新项目根路径，保持项目 ID 与其他元数据。该函数没有扫描所有历史内容并替换路径。[项目根解析 229–235](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/agent-workspace-manager.ts#L229-L235)、[重新关联 367–399](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/agent-workspace-manager.ts#L367-L399)

**`~` 展开只存在于特定文件路径入口。** `expandHomeDirectory` 识别当前用户的 `~`、`~/`、`~\`；其他相对路径按 Agent 当前工作目录解析。没有证据表明它是持久化资料通用的变量系统，也不支持猜测 `~other-user`。[agent-file-path.ts 1–29](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/agent-file-path.ts#L1-L29)

**原生会话仍有不同的路径依赖。** Pi 普通续聊在当前原生会话目录中按 sessionId 查找文件，再传入当前 cwd 打开；但分叉与回退仍读取持久化的 `piSessionFile`，要求该路径存在。因此普通续聊可定位文件，不代表所有原生会话操作已经消除了旧绝对路径依赖。[查找原生会话 465–472](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts#L465-L472)、[续聊 1412–1420](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/adapters/pi-agent-adapter.ts#L1412-L1420)、[分叉 850–883](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/agent-session-manager.ts#L850-L883)、[回退 938–955](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/agent-session-manager.ts#L938-L955)

## 技能与启动

默认技能从 App bundle 复制到数据目录的 `default-skills`，新工作区再复制到自己的 `skills`。跨工作区导入也复制内容，来源元数据记录工作区 slug、技能版本等，不靠指向旧设备外部目录的顶层链接维持导入关系。[默认技能复制 237–258](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/agent-workspace-manager.ts#L237-L258)、[跨工作区导入 976–1023](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/agent-workspace-manager.ts#L976-L1023)

这些复制调用没有声明 `dereference: true`，不能据此推断技能目录内部所有链接都被实体化。迁移提示词也没有说明 symlink、Windows junction 或包外目标如何处理。没有找到专用的跨设备技能链接转换机制。

`seedDefaultSkills` 对每个技能的同步单独捕获异常，整体扫描另有异常捕获；启动入口又通过 `safeRun` 调用它。一个技能复制失败不会直接抛出并中断这个初始化调用链。其缺失检查仍使用 `existsSync`，没有对断链提供专门修复。这里的收益是启动隔离，不是证明坏技能已经恢复。[seedDefaultSkills 558–607](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/config-paths.ts#L558-L607)、[启动 730–738](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/index.ts#L730-L738)

## 跨系统证据与边界

Proma 声明提供 macOS Apple Silicon、macOS Intel、Windows 和 Linux 安装包；发布流水线确实有 Windows 构建。这证明应用分发目标，不证明四个方向的数据迁移已验收。[README 55](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/README.md#L55)、[Windows 构建 367–402](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/.github/workflows/release.yml#L367-L402)

仓库的 `normalizePathForCompare` 只转换斜杠与移除尾斜杠，没有盘符到 macOS 目录的映射。没有发现针对整包迁移的 Mac→Windows、Windows→Mac 恢复验证或源操作系统路径解析契约。[normalize-path.ts](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/packages/shared/src/utils/normalize-path.ts)

渠道凭据使用 Electron `safeStorage`；源码分别标明 macOS Keychain、Windows DPAPI、Linux Secret Service。迁移提示词要求新设备重新配置凭据，这与实现一致。但加密不可用时存在明文存储分支，所以不能仅凭页面文案承诺 ZIP 中绝无密钥材料。[channel-manager.ts 432–466](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/channel-manager.ts#L432-L466)

## 对 Zora 的设计取舍

1. 保留创建包、带到新设备、恢复、按需编辑项目目录的短流程。目录失效继续使用已确定的灰态与编辑入口，不加入原因分类。
2. 迁移包在源设备生成时就应包含要携带的技能实体。目标设备拿到一个失效链接，无法凭链接找回未打包的内容。
3. 托管文件使用数据根目录下的相对引用或 ID；外部项目使用本机绑定；项目内子目录使用相对项目根的位置。`HOME` 只负责发现当前设备主目录，不承担推断外部资源对应关系的职责。
4. 恢复时解析旧结构化路径需要知道源平台，不能直接用目标平台的路径规则处理 Windows 盘符与反斜杠。新格式用明确的相对位置减少后续转换需求，不对聊天正文、命令或技能文案做全局字符串替换。
5. 把可启动、包内容完整、一次一致恢复和路径引用正确作为固定产品规则；Agent 可以组织打包与恢复，不需要扩张成复杂导入向导，也不能让提示词承担全部数据正确性。

以上五条为研究建议；本次没有修改产品代码或执行实际迁移。

## 补充核查：在线自覆盖与已有数据

根据用户注释再次核查：恢复提示词第 1 步明确覆盖前确认并备份，第 2 步直接解压到本机数据目录。没有停机、写入暂停、离线切换或双端历史冲突规则。检索迁移入口与主进程实现仍只找到打开目录的专用 IPC，不能将提示词解释为已有恢复事务。[恢复提示词](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/renderer/components/settings/MigrationSettings.tsx#L17-L25)

Proma 普通 Agent 消息通过 `appendAgentMessage()` 写入 JSONL 并更新索引；权限服务按工具、权限模式和用户确认处理，所核查路径未发现专门禁止写入整个 `.proma` 的规则。因此覆盖风险来自恢复操作与运行期写入交错，不能推断为操作系统绝对禁止 Agent 修改自身数据。本次只读核查，没有在线覆盖试验。[消息写入](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/agent-session-manager.ts#L462-L475)、[权限服务](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/agent-permission-service.ts#L121-L164)

Proma 已考虑目标数据存在时的确认和备份，但没有在该流程中实现整库合并。检索到的 `mergeFetchedAgentSessions` 等处理界面状态或列表汇总，不属于两台设备的会话历史合并。

会话索引 `INDEX_VERSION = 2` 与历史数据转换是独立的代码能力，可以借鉴其职责分工；这也不证明恢复时会自动处理所有未知版本。[索引版本](https://github.com/proma-ai/Proma/blob/f99edbdb594407ab190b97ae073889c5d96637ab/apps/electron/src/main/lib/agent-session-manager.ts#L54-L68)
