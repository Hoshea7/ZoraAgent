# 技能软链接与迁移恢复的开源实践

调查日期：2026-09-12。只核查 Pi 技能加载与 Cherry Studio 备份恢复两条实现，不扩展成产品推荐。在线读取官方源码，并按 GitHub API 返回的提交固定证据；未运行这两个产品，也未修改用户数据。

| 项目 | 固定源码版本 | 本次范围 |
|---|---|---|
| badlogic/pi-mono | `71dca871bc80b6bc97be37f0ca3189399d651fff` | `packages/coding-agent/src/core/skills.ts` |
| CherryHQ/cherry-studio | `041045ef52f456f79d1e88045cd89d1681e13d2c` | `src/main/services/LegacyBackupManager.ts`，当前主分支的备份实现，非稳定发行版保证 |

## Pi：正常跟随链接，断链不阻断其他技能

Pi 扫描技能目录时，遇到符号链接便用 `statSync` 检查目标类型；有效目录继续递归，目标无法访问时跳过。`SKILL.md` 自身也可以是符号链接，读取其目标失败同样跳过。[目录扫描 183–258](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/skills.ts#L183-L258)

加载集合按 `canonicalizePath(skill.filePath)` 去重，避免同一份技能通过两个链接重复进入列表。对于用户显式配置的不存在路径，则记录 warning 后继续处理其他路径。[去重 409–449](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/skills.ts#L409-L449)、[显式路径 477–505](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/skills.ts#L477-L505)

适用边界：这些是只读发现规则，既不复制技能，也不删除或修复断链。源码没有在这里执行 Windows junction 转换。Zora 可以沿用有效技能正常加载、无效技能不影响其他能力的原则；启动期补装内置技能是另一条写入链路，不能由加载器的容错替代。

## Cherry Studio：备份时复制目标内容，恢复时不依赖原链接

完整备份的 `Data` 复制明确启用 `dereferenceSymlinks: true`。链接指向普通目录时递归生成实体目录；链接指向文件时通过文件流或 `fs.copy(..., { dereference: true })` 复制内容。通过 `realpath` 的当前递归集合跳过环形目录；断链或无法读取的链接记录日志后跳过。[备份配置 399–423](https://github.com/CherryHQ/cherry-studio/blob/041045ef52f456f79d1e88045cd89d1681e13d2c/src/main/services/LegacyBackupManager.ts#L399-L423)、[复制与链接处理 1804–1951](https://github.com/CherryHQ/cherry-studio/blob/041045ef52f456f79d1e88045cd89d1681e13d2c/src/main/services/LegacyBackupManager.ts#L1804-L1951)

这个实现允许解引用到 `Data` 外的目标并记录日志，说明其备份范围可随可读链接扩大。它不能证明断链对应资料被完整携带；被跳过的目标内容不会凭空恢复。对 Zora 有用的是在打包副本里实体化要迁移的技能，保留源目录与源链接，而不是照搬整个 Data 任意链接扩展规则。

恢复包中的 `Data` 使用 `dereferenceSymlinks: false`，对应复制逻辑会跳过链接。恢复目录因此不需要旧设备链接目标仍可访问。这是应用数据备份规则，不是技能专用加载规则。[恢复配置 988–1005](https://github.com/CherryHQ/cherry-studio/blob/041045ef52f456f79d1e88045cd89d1681e13d2c/src/main/services/LegacyBackupManager.ts#L988-L1005)、[不跟随链接 1924–1928](https://github.com/CherryHQ/cherry-studio/blob/041045ef52f456f79d1e88045cd89d1681e13d2c/src/main/services/LegacyBackupManager.ts#L1924-L1928)

## 恢复的是应用数据快照，未提供双端会话合并

`restoreDirect` 的范围包括备份声明的 SQLite、`cache.json`、`IndexedDB`、`Local Storage`、`Data`，以及相关格式中的应用 Claude 状态。它把资料放进独立恢复暂存目录，将整个备份数据库复制为 `work.sqlite`，并生成后续启动使用的替换日志。这里不是单条聊天导入。[恢复主流程 926–1039](https://github.com/CherryHQ/cherry-studio/blob/041045ef52f456f79d1e88045cd89d1681e13d2c/src/main/services/LegacyBackupManager.ts#L926-L1039)

其源码注释明确描述启动前验证、移开原数据、提升暂存数据与回滚语义；实现提交恢复日志后等待重启。当前备份阶段也会暂停并等待写入者、检查数据库快照，体现完整快照需要一致的数据边界。[备份一致性 336–374](https://github.com/CherryHQ/cherry-studio/blob/041045ef52f456f79d1e88045cd89d1681e13d2c/src/main/services/LegacyBackupManager.ts#L336-L374)、[提交恢复 1086–1118](https://github.com/CherryHQ/cherry-studio/blob/041045ef52f456f79d1e88045cd89d1681e13d2c/src/main/services/LegacyBackupManager.ts#L1086-L1118)

本次审阅的恢复路径没有按会话 ID 合并两边历史，而是准备整库与文件资源替换。项目的 [合并模式需求 #15601](https://github.com/CherryHQ/cherry-studio/issues/15601) 也将按记录合并列为独立需求，查看时为 Open；issue 仅作为辅助证据，不把提案写成已实现能力。

该恢复流程遇到源平台与当前平台不同只记录日志，没有在这一处替用户映射外部项目目录。因此也不能由支持恢复推断全部外部路径、技能脚本和设备依赖已适配新系统。[跨平台检查 959–967](https://github.com/CherryHQ/cherry-studio/blob/041045ef52f456f79d1e88045cd89d1681e13d2c/src/main/services/LegacyBackupManager.ts#L959-L967)

## 对当前 Zora 方案的直接启示

1. 技能可以保留本机软链接使用方式。加载有效目标，跳过坏目标；不因迁移需求改成所有技能必须复制安装。
2. 源设备打包时，在副本中放入要携带的技能实体。源链接不变；源目标已经不存在的内容应如实列为未携带。
3. 轻量指南可以采用退出应用后复制、在目标应用退出时恢复完整目录，获得一致读写边界；无需引入 Cherry 的数据库日志与完整备份引擎。
4. 完整恢复与保留双端新历史是不同操作。后者需要定义按身份去重、同一会话分歧、配置选择及关联资料处理，无法靠文件夹覆盖或解压实现。

以上是从两条源码链路提取的有限规则，不代表建议复制其整体架构。
