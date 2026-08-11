import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { MarkdownMessage } from "@/renderer/components/chat/MarkdownMessage";

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
  it("allows compact tables to wrap long cells with left alignment", () => {
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
    expect(table.closest("[data-table-variant]")).toHaveAttribute(
      "data-table-variant",
      "compact"
    );

    const longCellContent = screen.getByText("每个场景至少对应一类明确的业务价值");
    expect(longCellContent).toHaveClass("w-full", "whitespace-normal", "text-left");
    expect(longCellContent).not.toHaveClass("w-max", "whitespace-nowrap", "text-center");
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
    expect(table.closest("[data-table-variant]")).toHaveAttribute(
      "data-table-variant",
      "regular"
    );
    expect(table).toHaveClass("table-fixed");
    expect(table).not.toHaveClass("table-auto");

    const headerContent = screen.getByText("核心能力");
    expect(headerContent).toHaveClass("whitespace-normal", "text-left");
    expect(headerContent).not.toHaveClass("whitespace-nowrap");

    const longCellContent = screen.getByText(
      "读取财报PDF/Excel，生成结构化摘要并输出关键风险提示"
    );
    expect(longCellContent).toHaveClass("w-full", "max-w-none", "text-left");
    expect(longCellContent).not.toHaveClass("w-max");
    expect(longCellContent).not.toHaveClass("whitespace-nowrap");
  });
});
