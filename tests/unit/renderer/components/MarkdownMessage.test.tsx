import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import {
  CopyButton,
  MarkdownMessage,
  resolveAdaptiveTableWidth,
} from "@/renderer/components/chat/MarkdownMessage";

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
    expect(link).toHaveClass(
      "text-[var(--color-brand)]",
      "decoration-[var(--color-brand-muted)]",
      "hover:text-[#a85f37]"
    );

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
  it("keeps the established emphasis and ordered-list theme colors", () => {
    render(<MarkdownMessage content={"1. **重点内容**"} />);

    expect(screen.getByText("重点内容").closest("strong")).toHaveClass(
      "font-semibold",
      "text-[#211d19]"
    );
    expect(screen.getByRole("list")).toHaveClass(
      "marker:font-semibold",
      "marker:text-[var(--color-brand)]"
    );
  });

  it("uses restrained brand accents across body semantics", () => {
    render(
      <MarkdownMessage
        content={[
          "- 普通条目",
          "",
          "> 引用内容",
          "",
          "[外部链接](https://example.com)",
          "",
          "正文中的 `inlineCode`。",
        ].join("\n")}
      />
    );

    expect(screen.getByRole("list")).toHaveClass(
      "marker:text-[var(--color-brand-muted)]"
    );
    expect(screen.getByText("引用内容").closest("blockquote")).toHaveClass(
      "border-[var(--color-brand-muted)]"
    );
    expect(screen.getByRole("link", { name: "外部链接" })).toHaveClass(
      "text-[var(--color-brand)]",
      "decoration-[var(--color-brand-muted)]"
    );
    expect(screen.getByText("inlineCode").closest("code")).toHaveClass(
      "bg-[#f7eee7]",
      "text-[#8f4f2f]"
    );
  });

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
  it("expands only as far as needed to remove cramped wrapping", () => {
    expect(resolveAdaptiveTableWidth(820, 1180, () => false)).toBe(820);

    const modestExpansion = resolveAdaptiveTableWidth(
      820,
      1180,
      (width) => width < 960
    );
    expect(modestExpansion).toBeGreaterThanOrEqual(960);
    expect(modestExpansion).toBeLessThan(990);

    expect(resolveAdaptiveTableWidth(820, 1180, () => true)).toBe(1180);
    expect(resolveAdaptiveTableWidth(758, 758, () => true)).toBe(758);
  });

  it("keeps source lines intact inside the compact code-block frame", () => {
    const { container } = render(
      <MarkdownMessage content={"```text\n一段很长的正文内容\n```"} />
    );

    const body = container.querySelector(".ai-message-content");
    const codeBlock = container.querySelector('[data-streamdown="code-block"]');
    const codeBlockBody = container.querySelector('[data-streamdown="code-block-body"]');

    expect(codeBlock).toBeInTheDocument();
    expect(codeBlockBody).toBeInTheDocument();
    expect(body).toHaveClass("overflow-visible");
    expect(body).toHaveClass(
      "[&_[data-streamdown=code-block]]:gap-0",
      "[&_[data-streamdown=code-block]]:border-stone-200/80",
      "[&_[data-streamdown=code-block-body]]:border-0",
      "[&_[data-streamdown=code-block-body]]:rounded-none",
      "[&_[data-streamdown=code-block-actions]]:border-0"
    );
    expect(body).toHaveClass(
      "[&_[data-streamdown=code-block-body]]:overflow-x-auto"
    );
    expect(body).not.toHaveClass(
      "overflow-x-hidden",
      "[&_[data-streamdown=table-wrapper]]:overflow-x-auto",
      "[&_pre]:overflow-visible",
      "[&_[data-streamdown=code-block-body]]:overflow-x-hidden",
      "[&_pre]:whitespace-pre-wrap",
      "[&_pre]:break-words"
    );
    expect(codeBlockBody?.querySelector("code")).not.toHaveClass(
      "[counter-increment:line_0]",
      "[counter-reset:line]"
    );
  });

  it("keeps tables responsive and allows long cells to wrap", () => {
    const { container } = render(
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
    expect(table).toHaveClass(
      "relative",
      "left-1/2",
      "w-full",
      "min-w-full",
      "max-w-[min(100cqi,1180px)]",
      "-translate-x-1/2",
      "table-auto",
      "text-[15px]",
      "leading-[1.55]"
    );
    expect(table).not.toHaveClass(
      "w-max",
      "w-[min(100cqi,1180px)]",
      "table-fixed",
      "text-[13px]"
    );

    expect(container.querySelector(".ai-message-content")).not.toHaveClass(
      "[container-type:inline-size]"
    );

    const longCellContent = screen.getByText("每个场景至少对应一类明确的业务价值");
    expect(longCellContent.closest("td")).toHaveClass(
      "min-w-0",
      "break-words",
      "px-[clamp(8px,2cqi,14px)]",
      "py-[clamp(7px,1.4cqi,10px)]",
      "[overflow-wrap:anywhere]"
    );
    expect(longCellContent.closest("td")).not.toHaveClass("max-w-[480px]");
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
    expect(table).toHaveClass(
      "w-full",
      "min-w-full",
      "max-w-[min(100cqi,1180px)]",
      "table-auto",
      "border-collapse"
    );
    expect(table).not.toHaveClass("table-fixed");

    const headerContent = screen.getByText("核心能力");
    expect(headerContent.closest("th")).toHaveClass(
      "text-stone-700",
      "px-[clamp(8px,2cqi,14px)]",
      "py-[clamp(7px,1.4cqi,10px)]"
    );

    const longCellContent = screen.getByText(
      "读取财报PDF/Excel，生成结构化摘要并输出关键风险提示"
    );
    expect(longCellContent.closest("td")).toHaveClass(
      "break-words",
      "[overflow-wrap:anywhere]"
    );
  });

  it("renders incomplete streaming markdown without exposing raw fence markers", () => {
    render(<MarkdownMessage content={"```ts\nconst answer = 42"} isStreaming />);
    expect(screen.getByText(/const answer = 42/)).toBeInTheDocument();
    expect(screen.queryByText("```ts")).toBeNull();
  });

  it("softens only newly streamed words without moving existing content", () => {
    const { container, rerender } = render(
      <MarkdownMessage content="正在生成新的正文" isStreaming />
    );

    expect(container.querySelectorAll("[data-sd-animate]").length).toBeGreaterThan(0);
    expect(container.querySelector("[data-sd-animate]")).toHaveStyle({
      "--sd-animation": "sd-fadeIn",
      "--sd-duration": "120ms",
      "--sd-easing": "cubic-bezier(0.16, 1, 0.3, 1)",
    });

    rerender(<MarkdownMessage content="已经生成完成" />);
    expect(container.querySelector("[data-sd-animate]")).toBeNull();
  });
});
