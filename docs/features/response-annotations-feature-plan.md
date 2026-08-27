# AI 回复划词批注

> 状态：已实现，已完成本地验证
>
> 更新日期：2026-08-27
>
> 适用范围：Zora 桌面端聊天界面
>
> Runtime：Pi 与 Claude 使用同一消息合同

## 功能结论

用户可以在已经生成完成的 AI 正文中选择文字，添加一条带可选评论的批注。多条批注挂在当前输入草稿中，随下一条用户消息一起发送。AI 同时获得用户的整体要求、逐条所选原文和评论。

单条空评论批注已经覆盖快速引用，因此产品只保留批注入口，不再增加独立引用功能。当前聊天布局使用正文编号与输入框批注列表，不增加右侧常驻评论栏。

## 用户体验

### 添加批注

1. 用户在已完成的 AI 正文中选择连续文本。
2. 原生文字选择保持不变，选区上方显示矩形的“添加批注”按钮。
3. 用户点击按钮后，所选内容显示主题色浅背景和下划线，评论编辑器出现在选区右上方。
4. 评论可以留空。Enter 保存，Shift + Enter 换行，Esc 取消。
5. 保存后移除背景色，保留下划线，并在正文右侧标记区显示编号。

按钮和编辑器使用独立浮层，不改变正文或主输入框布局。短选区按中心定位；长选区和跨行选区向选择末端偏移。编辑器始终保持在选区右侧，并限制在窗口可见范围内。

### 管理多条批注

输入框上方显示“N 条批注”入口。点击后，批注列表以独立浮层显示在输入框上方，输入框高度保持不变。

列表按原文阅读顺序排列。每条包含：

- 灰色的所选原文。
- 用户评论。
- 定位、编辑和删除图标。

点击定位后，列表立即关闭。页面滚动到对应编号，目标原文短暂显示主题色背景、下划线和闪烁提示。目标已经位于当前画面时也执行同样的视觉引导。

同一草稿只允许批注同一条 AI 回复。用户需要先发送或清空当前批注，再批注另一条回复。

### 发送与历史展示

主输入文字、附件或批注任一存在时均允许发送。主输入为空且存在批注时，产品写入可见默认指令：

> 请基于以下评论批注内容给出反馈。

该表达只陈述消息包含评论批注，不限制评论的影响范围。评论虽然关联局部原文，仍可以表达对整条回复的整体意见。

发送后：

- 原 AI 回复上的临时下划线和编号清除。
- 用户消息保留整体文字和“N 条批注”入口。
- 展开后，所选原文使用灰色，用户评论使用正常正文颜色。
- 已发送批注只读，不提供编辑和删除。
- 历史消息重新运行时保留原批注，并再次进入 Runtime 上下文。

## 范围

### 已支持

- 所有已完成的 AI 正文，包括标题、段落、列表、表格和代码块。
- 同一条回复内跨文本节点、跨段落和跨行的连续选择。
- 单条和多条批注。
- 空评论批注。
- 正文下划线、右侧编号、输入框批注列表。
- 批注定位、编辑和删除。
- 会话切换后的草稿保留。
- Session JSONL 持久化。
- Pi、Claude、恢复上下文和 Memory Agent 投影。
- 来源位置不可用时保留所选原文和评论。

### 未支持

- 独立引用入口。
- 富文本输入框中的可编辑引用块。
- 多条 AI 回复混合成同一批批注。
- 思考过程、工具执行信息和用户消息批注。
- 流式正文批注。
- 应用重启后的待发送草稿恢复。
- 已发送批注在原 AI 回复上的长期标记。
- 多人评论、回复、解决状态和指派。
- 手动拖动批注排序。

## 数据模型

共享消息合同位于 `src/shared/zora.d.ts`：

```typescript
export interface ResponseAnnotationAnchor {
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

export interface ResponseAnnotation {
  id: string;
  sourceMessageId: string;
  anchor: ResponseAnnotationAnchor;
  comment?: string;
}
```

`ConversationMessage` 和 `SubmitUserMessageInput` 都使用 `responseAnnotations?: ResponseAnnotation[]`。批注保留结构化数据，不提前拼接进用户可见正文。

写入边界统一执行以下规则：

- `id` 和 `sourceMessageId` 必须为非空字符串。
- `startOffset` 和 `endOffset` 使用 UTF-16 偏移。
- `endOffset` 必须大于 `startOffset`。
- `selectedText` 必须包含非空白字符。
- 空白评论归一化为 `undefined`。
- 同一批次中的 ID 唯一。
- 同一批次只允许一个 `sourceMessageId`。
- 批注按 `startOffset`、`endOffset`、`id` 排序。

## 文本锚点

每条完成的 AI 回复正文由 `ResponseAnnotationSurface` 包裹。锚点只计算正文中的可见文本节点，忽略按钮、输入框、SVG、脚本、样式、可编辑节点、隐藏节点和显式排除节点。

捕获选择时保存：

- 来源消息 ID。
- 起止偏移。
- 精确所选文本。
- 当前交互使用的 DOM Range 和位置矩形。

DOM Range 和位置矩形只存在于当前组件状态，不进入草稿、IPC 或 Session JSONL。

恢复时根据偏移重建 Range，再比较 `range.toString()` 与 `selectedText`。两者一致才恢复编号和定位。内容发生变化时保留批注数据，同时禁用定位。产品不做模糊文本搜索，避免同一段文字重复出现时定位错误。

## Renderer 状态与组件

### 草稿状态

`src/renderer/store/chat.ts` 按 Session 保存三类草稿：

- 主输入文字。
- 文件附件。
- 回复批注。

批注写入通过共享规范化函数校验。删除 Session 时同步清理三类草稿；切换 Session 只切换当前投影。应用退出后草稿随 Renderer 内存释放。

### 正文交互

`ResponseAnnotationSurface.tsx` 负责：

- 捕获选择。
- 展示“添加批注”按钮和评论编辑器。
- 恢复文本 Range。
- 根据 Range 矩形绘制下划线和定位强调。
- 在正文右侧预留 28px 标记区。
- 点击编号编辑已有批注。

选择完成由组件生命周期内的 document 级 `mouseup` 监听接收，再用当前 surface 和 Range 校验选区归属。鼠标在正文边缘松开时仍可识别合法选区，其他消息和交互控件中的选择不会进入当前批注。

正文评论编辑器只提供取消和保存。删除操作集中在输入框批注列表中，避免编辑器同时承担内容修改和批注管理。

下划线、编辑态背景和定位强调共用同一套 Range 矩形。正文保持在覆盖层上方，颜色不会遮挡文字。

### 输入框批注列表

`ResponseAnnotationComposer.tsx` 负责：

- 显示批注数量。
- 通过 Portal 在输入框上方渲染浮层。
- 编辑评论。
- 删除批注。
- 请求来源定位。
- 来源不可用时禁用定位。

定位事件只有一个语义：根据 `sourceMessageId` 找到正文 surface，再按 `annotationId` 定位对应编号。事件层不保留通用 action 抽象。

### 已发送用户消息

`UserMessage.tsx` 使用原生 `details` 展示只读批注。展开状态只属于当前界面，不写入消息数据。展开时恢复当前视口锚点，避免消息高度变化导致阅读位置跳动。

## 消息与 Runtime 投影

`src/shared/response-annotations.ts` 是批注规则的唯一共享模块，负责：

- 数据规范化。
- 阅读顺序排序。
- 默认可见指令。
- Runtime 文本格式化。

Runtime 投影如下：

```xml
用户的整体要求

<response_annotations>
  <annotation index="1">
    <selected_text>所选原文</selected_text>
    <comment>用户评论</comment>
  </annotation>
</response_annotations>
```

用户内容经过 XML 转义。`sourceMessageId` 和 DOM 偏移只服务产品定位，不发送给模型。

该投影用于：

- 当前 Pi 或 Claude Prompt。
- Pi 历史消息重建。
- 正在运行任务的排队消息。
- Productivity Runner 恢复上下文。
- Memory Agent 会话序列化。

## 持久化

用户发送时，Renderer 先用同一个快照创建乐观消息，再通过 `submitUserMessage` 提交。Main 重新规范化批注并写入用户消息记录。

Session JSONL 保存完整 `responseAnnotations`。加载历史时重新规范化，避免无效数据进入 Renderer 和 Runtime。

历史消息修改并重新运行时只修改整体文字，保留原批注、附件和消息 ID。批注继续参与 Runtime 格式化。

## 关键代码

| 层级 | 文件 | 职责 |
| --- | --- | --- |
| Shared | `src/shared/zora.d.ts` | 批注、消息和 IPC 类型 |
| Shared | `src/shared/response-annotations.ts` | 校验、排序、默认指令和 Runtime 投影 |
| Main | `src/main/session-interaction.ts` | 提交、排队和持久化 |
| Main | `src/main/session-runner.ts` | 普通运行和历史重跑 |
| Main | `src/main/session-store.ts` | Session JSONL 读写 |
| Main | `src/main/runtime/pi-conversation.ts` | Pi 历史投影 |
| Main | `src/main/runtime/pi-session-bridge.ts` | 当前消息识别与 Pi 会话桥接 |
| Main | `src/main/productivity-runner.ts` | 恢复上下文投影 |
| Main | `src/main/memory-agent.ts` | Memory Agent 投影 |
| Renderer | `src/renderer/utils/responseAnnotationRange.ts` | Range 捕获、恢复和浮层位置 |
| Renderer | `src/renderer/components/chat/ResponseAnnotationSurface.tsx` | 正文交互与标记 |
| Renderer | `src/renderer/components/chat/ResponseAnnotationComposer.tsx` | 输入框批注管理 |
| Renderer | `src/renderer/components/chat/UserMessage.tsx` | 已发送批注展示 |
| Renderer | `src/renderer/store/chat.ts` | Session 级批注草稿 |

## 测试合同

### L1 Unit

- 数据规范化、排序、XML 转义和默认指令。
- DOM Range 跨文本节点捕获和恢复。
- 来源内容变化后的定位失效。
- 操作按钮和编辑器定位。
- Session 草稿隔离、范围更新、单来源限制和评论规范化。
- 正文编号定位到精确 marker。
- 已发送批注的信息层级和历史编辑保留。

### L2 Integration

- 用户消息持久化结构化批注。
- 正在运行的 Agent 收到 Runtime 投影。
- 普通运行和排队运行使用同一消息语义。

### L3 E2E

- 真实 Electron 中划词、添加、编辑、删除、定位和发送。
- 选择态、编辑态、保存态的颜色和层级。
- 浮层不改变主输入框高度。
- 多条批注按阅读顺序显示。
- 切换会话后恢复草稿。
- Pi 和 Claude 真实 Provider 均能根据评论内容回复。

## 边界

- 来源内容发生变化时，批注内容仍可发送，定位不可用。
- 同一范围再次添加会更新原批注；部分重叠范围保留为独立批注。
- 当前版本不持久化未发送批注草稿。
- 当前版本不在历史 AI 回复上长期展示已发送批注。
- 批注是用户消息的一部分，不建立独立评论线程。
