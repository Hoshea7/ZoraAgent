import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { CopyButton, MarkdownMessage } from "@/renderer/components/chat/MarkdownMessage";

describe("MarkdownMessage actions", () => {
  it("uses the shared complete copy icon", () => {
    const { container } = render(<CopyButton content="正文" />);
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    expect(container.querySelector("rect[x='8'][y='8']")).toBeInTheDocument();
  });
});

describe("MarkdownMessage links", () => {
  it("opens absolute links through the external browser bridge", () => {
    render(<MarkdownMessage content="[Docs](https://example.com/path?q=1)" />);

    const link = screen.getByRole("link", { name: "Docs" });
    expect(link).toHaveAttribute("target", "_blank");

    fireEvent.click(link);

    expect(vi.mocked(window.zora.openExternal)).toHaveBeenCalledWith(
      "https://example.com/path?q=1"
    );
  });

  it("keeps anchor links inside the markdown document", () => {
    render(<MarkdownMessage content="[Jump](#section)" />);

    const link = screen.getByRole("link", { name: "Jump" });
    expect(link).not.toHaveAttribute("target");

    fireEvent.click(link);

    expect(vi.mocked(window.zora.openExternal)).not.toHaveBeenCalled();
  });
});

describe("MarkdownMessage lists", () => {
  it("reserves internal marker space for ordered lists with two-digit numbers", () => {
    const items = Array.from({ length: 12 }, (_, index) => `${index + 1}. 项目 ${index + 1}`);

    render(<MarkdownMessage content={items.join("\n")} />);

    const orderedList = screen.getByRole("list");
    expect(orderedList).toHaveClass("list-outside", "list-decimal", "pl-8");
    expect(orderedList).not.toHaveClass("ml-5");
    expect(screen.getByText("项目 12")).toBeInTheDocument();
  });

  it("keeps task lists unindented when marker spacing is disabled", () => {
    render(<MarkdownMessage content="- [ ] 待处理\n- [x] 已完成" />);

    const taskList = screen.getByRole("list");
    expect(taskList).toHaveClass("list-none", "pl-0");
    expect(taskList).not.toHaveClass("pl-6");
  });
});

describe("MarkdownMessage tables", () => {
  it("keeps tables responsive and allows long cells to wrap", () => {
    render(
      <MarkdownMessage
        content={[
          "| 页 | 改前 | 改后 | 原因 |",
          "| --- | --- | --- | --- |",
          "| P8 | 每个场景至少对应一类明确的业务价值 | 场景应明确至少一类业务价值 | 大纲对，加应 |",
        ].join("\n")}
      />
    );

    const table = screen.getByRole("table");
    expect(table).toHaveAttribute("data-table-variant", "responsive");

    const longCellContent = screen.getByText("每个场景至少对应一类明确的业务价值");
    expect(longCellContent.closest("td")).toHaveClass("max-w-[480px]", "[overflow-wrap:anywhere]");
  });

  it("wraps regular four-column tables inside the message width", () => {
    render(
      <MarkdownMessage
        content={[
          "| Skill名称 | 来源 | 核心能力 | MCP/API依赖 |",
          "| --- | --- | --- | --- |",
          "| 企业工商信息查询 | TH-ZT-JC / FA-ZT-JC | 查企业基础信息（注册/股权/法眼查/企查查） | API → MCP封装 |",
          "| 财务报表解读与摘要 | TH-ZT-CW / FA-ZT-CW | 读取财报PDF/Excel，生成结构化摘要并输出关键风险提示 | 依赖，纯LLM能力 |",
          "| 法律制度检索助手 | SD-23 | 法律法规时效性检索+引用验证 | 法律数据库API → MCP封装 |",
        ].join("\n")}
      />
    );

    const table = screen.getByRole("table");
    expect(table).toHaveAttribute("data-table-variant", "responsive");
    expect(table).toHaveClass("min-w-full");

    const headerContent = screen.getByText("核心能力");
    expect(headerContent.closest("th")).toHaveClass("text-stone-700");

    const longCellContent = screen.getByText(
      "读取财报PDF/Excel，生成结构化摘要并输出关键风险提示"
    );
    expect(longCellContent.closest("td")).toHaveClass("max-w-[480px]", "[overflow-wrap:anywhere]");
  });

  it("renders incomplete streaming markdown without exposing raw fence markers", () => {
    render(<MarkdownMessage content={"```ts\nconst answer = 42"} isStreaming />);
    expect(screen.getByText(/const answer = 42/)).toBeInTheDocument();
    expect(screen.queryByText("```ts")).toBeNull();
  });
});
