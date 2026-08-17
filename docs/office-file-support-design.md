# Office 文件能力补齐方案（读取优先）

> 状态：方案已对齐，待实施
> 日期：2026-08-17
> 范围：PDF / DOCX / XLSX / PPTX 的读取能力（附件入口 + Agent 工具入口）；生成/编辑不在本期范围

## 一、现状诊断

Zora 读 PDF/office 文件，两条路都是断的。

### 附件入口

- 拖拽白名单（`src/renderer/components/chat/ChatInput.tsx` 的 `DROP_MIME_MAP`）只有图片 5 种 + PDF + 纯文本 14 种，docx/xlsx/pptx 直接拒收。
- PDF 进得来（category=document），但投影层（`src/main/attachment-handler.ts` 的 `buildPdfFallbackBlock`）直接返回一段"当前链路不支持 document 输入"的 fallback 文本，模型拿不到任何内容。
- text 类附件直接 `readFileSync(utf-8)` 全文 inline，无截断保护。

### 工具入口

两个 runtime 的 Read 工具对二进制文件都没有处理：

- Pi 的 Read（`github_ref/pi/packages/coding-agent/src/core/tools/read.ts:250-274`）是二分法：魔数嗅探识别出图片则转 base64 ImageContent，其余一律 `buffer.toString("utf-8")` 硬解码，PDF/office 全是乱码。
- Claude Agent SDK（0.2.76）的 Read 同样没有 PDF 分支。实测读 `claude_agent_sdk_ref/SkillOS.pdf`，返回 `%PDF-1.5` 开头的对象结构乱码。
- Zora 的 Pi 桥接（`src/main/vision/image-read-guard.ts` 的 `wrapPiReadTool`）目前只拦截图片读取做 vision guard，无 PDF/office 处理。

## 二、参考产品调研结论

| 产品 | PDF 读取 | office 读取 | 依赖策略 |
|------|---------|-----------|---------|
| Claude Code | Read 把 PDF 整体转 base64 document block，走 Anthropic API 原生解析（服务端每页转图 + 抽文本）；限制 100 页/32MB，超 10 页强制指定页范围，单次最多 20 页 | 无内置，官方 skill（Python） | 原生输入只在 Anthropic 协议可用 |
| codex CLI | 无内置。内核只有 shell + view_image 两个原语，PDF 下沉到 skill 里的 Python 脚本 | 同左 | 内核极简，文档解析归生态 |
| Proma | 双层：主进程 JS 解析层（pdf-parse 主 + pdfjs 兜底），chat 模式发消息前提取文本以 `<file>` 标签注入；Agent 模式靠官方 skill | JS 层 mammoth 主 + officeparser 兜底；旧 doc 用 word-extractor；RTF 自写 130 行解析器 | 读走 JS 零依赖，改/建走 Python skill |
| Pi | Read 对 PDF 无处理，utf-8 乱码 | 无处理 | 哲学同 codex：提取不归 Read 管 |

关键参考证据：

- Proma 解析层：`github_ref/Proma/apps/electron/src/main/lib/document-parser.ts`（按扩展名分发，多级兜底链）；消息注入：`chat-service.ts` 的 `enrichMessageWithDocuments`。
- Proma 内置官方 skills：`apps/electron/default-skills/`（Anthropic 原文），启动时 seed 到用户目录。
- Claude Code PDF 全量入上下文的已知坑：GitHub issue anthropics/claude-code#30546，PDF block 永久驻留对话历史不去重不淘汰，几轮迭代打爆 token。
- 官方 pdf skill（v1.0.5）自带分层路由：只读任务优先内置 Read，超 100 页用 markitdown，改 PDF 才用 Python 库。与本方案"读写分离"结构吻合。

## 三、方案：主进程提取核心 + 双入口 + 读写分离

### L0 提取核心（新增）

`src/main/document-extract.ts`，纯 JS 实现，统一入口：

```ts
extractDocument(filePath: string, opts?: ExtractOptions): Promise<ExtractResult>
// ExtractResult = { text: string; meta: DocumentMeta }
// DocumentMeta = { format; pages?; sheets?; slides?; truncated; totalChars }
```

按扩展名 + 魔数分发：

| 格式 | 库 | Bun 1.3.10 实测 |
|------|-----|----------------|
| PDF | unpdf | 33 页英文论文完整提取，中文正常 |
| DOCX | mammoth（extractRawText） | 正常 |
| XLSX | exceljs（输出 markdown 表格，每 sheet 一段） | 正常 |
| PPTX | officeparser（结构化 content，含 slide 页码） | 正常 |
| 旧 .doc | word-extractor | 低频，按需 |

实测脚本：unpdf/mammoth/exceljs/officeparser 在 Bun 下全部跑通，零 Python 依赖，打包体积增量约 2MB（主要是 pdf.js）。

约定：

- 单次返回上限 50KB（对齐 Pi Read 的截断约定），截断时返回分页游标信息。
- 分页续读：PDF 按页范围，XLSX 按 sheet + 行范围，DOCX/PPTX 按字符偏移。
- 扫描版 PDF（提取文本近空）返回明确提示：可能是图片型 PDF，可转图片走 Inspect Image。
- 未知二进制格式直接报错，不尝试 utf-8 解码（避免乱码污染上下文）。

### L1 双入口接入

#### 附件入口

1. `DROP_MIME_MAP` 加 `.docx/.xlsx/.pptx/.doc`，category 归入 document。
2. `attachment-handler.ts` 的 document 分支重写：
   - 提取文本，结果小于阈值（约 30KB）→ inline 全文（`<file name>` 包裹 + 元信息头：页数/sheet 数/字数）。
   - 大文件 → 只 inline 元信息（页数 + 前 N 字符预览）+ attachmentId + 路径，引导 Agent 用 read_document 分页读。
3. 附件形成完整三档模式：text 类 inline、图片类引用 + Inspect Image、大文档类元信息 + read_document 分页。

#### 工具入口

1. 注册产品工具 `read_document`，双 runtime 统一注册，复用 inspect_image 已验证的产品工具模式（`src/main/vision/inspect-image.ts` 为模板）。
2. 参数：path + 可选 pages/sheet/offset。
3. 工具描述明确写：Read 工具读 PDF 和 office 文件会得到乱码，请使用本工具。
4. Pi 侧加保险：`wrapPiReadTool` 从只 guard 图片扩展为同时拦截 PDF/office 扩展名的 Read 调用，返回引导提示。
5. Claude 侧起步靠工具描述 + system prompt 引导。

### L2 生成/编辑（本期不动）

- 官方 office skills 已装在 `~/.zora/skills/`（pdf/docx/pptx/xlsx），改/建文件走 Python 生态，保持不动。
- 只补一件事：skill 执行失败时检测 Python/uv 缺失，给用户可懂的安装指引，避免静默失败。

## 四、关键决策及理由

1. **不走 Claude Code 的原生 document block 路线**：Zora 是多渠道产品，GLM/DeepSeek/qwen 渠道不支持 PDF 原生输入；火山渠道有输出静默截断前科，多模态输入更不可靠。文本提取是确定性工作，本地做一次实现全渠道通用。
2. **不纯靠 skills（codex 路线）**：读 PDF 是高频基础能力，桌面产品要求用户先装 Python 才能读文件，体验断裂。读取内建零依赖，生成走 skill 按需，读写分离（Proma 验证的成熟模式）。
3. **不重写 Read**：Read 是通用文本工具，PDF/office 是特例。特例用专门工具 + 引导，成本最低且模式已验证；重写 Read 要在两个 runtime 各维护一份完整实现，还要保持行号/分页全部语义，得不偿失。
4. **大文档附件不全文 inline**：几十页 PDF 全量 inline 直接爆 token，且会话历史永久膨胀（Claude Code issue #30546 的教训）。元信息 inline + 工具分页按需读，token 可控。

## 五、实施切片（垂直切片，每片独立验证）

| 切片 | 内容 | 用户可感知验收 |
|------|------|--------------|
| 1 | document-extract 核心 + PDF 附件投影 | 拖 PDF 说"总结这个"，回复包含 PDF 实际内容 |
| 2 | read_document 工具双 runtime 注册 + prompt 引导 | 让 Agent 读工作区任意 PDF，Agent Trace 出现 read_document 且内容正确 |
| 3 | office 白名单扩展 + Pi read 拦截 + 分页打磨 | docx/xlsx/pptx 拖拽可读；Pi 下 Read 硬读 PDF 被拦截引导 |

测试要求（按 AGENTS.md）：

- 每格式提取器一个 L1 单测（fixtures 用小样本文件进仓库）。
- 截断/分页逻辑 L1 单测。
- 切片 1/2 各配一个 E2E（真实 Provider，验证 Agent Trace 工具调用 + 回复内容）。

## 六、依赖增量

`unpdf`、`mammoth`、`exceljs`、`officeparser`、（可选 `word-extractor`）。全部纯 JS，Bun 兼容已实测，无原生模块，electron-builder 打包无特殊处理。
