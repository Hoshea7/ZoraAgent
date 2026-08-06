import type { ProcessStep, ToolAction } from "@/shared/zora";
import {
  buildProcessSummary,
  cleanToolName,
  formatToolName,
  getToolSummaryText,
} from "@/renderer/utils/toolSummary";

function createTool(overrides: Partial<ToolAction> = {}): ToolAction {
  return {
    id: "tool-1",
    name: "read",
    input: "{}",
    status: "done",
    startedAt: 0,
    ...overrides,
  };
}

describe("cleanToolName", () => {
  it("removes the default_api prefix", () => {
    expect(cleanToolName("default_api:read")).toBe("read");
  });

  it("falls back to tool for blank names", () => {
    expect(cleanToolName("   ")).toBe("tool");
  });
});

describe("formatToolName", () => {
  it("capitalizes the cleaned tool name", () => {
    expect(formatToolName("default_api:write")).toBe("Write");
  });
});

describe("getToolSummaryText", () => {
  it("shows bash commands", () => {
    expect(
      getToolSummaryText(
        createTool({
          name: "bash",
          input: "{\"command\":\"bun run test:unit\"}",
        })
      )
    ).toBe("bun run test:unit");
  });

  it("shows the basename for read tools", () => {
    expect(
      getToolSummaryText(
        createTool({
          name: "read",
          input: "{\"file_path\":\"/tmp/project/src/main.ts\"}",
        })
      )
    ).toBe("main.ts");
  });

  it("shows the basename for write tools", () => {
    expect(
      getToolSummaryText(
        createTool({
          name: "write",
          input: "{\"path\":\"/tmp/project/tests/result.txt\"}",
        })
      )
    ).toBe("result.txt");
  });

  it("shows the pattern for glob tools", () => {
    expect(
      getToolSummaryText(
        createTool({
          name: "glob",
          input: "{\"pattern\":\"src/**/*.ts\"}",
        })
      )
    ).toBe("src/**/*.ts");
  });

  it("shows the search pattern for grep tools", () => {
    expect(
      getToolSummaryText(
        createTool({
          name: "grep",
          input: "{\"pattern\":\"generateSmartTitle\"}",
        })
      )
    ).toBe("generateSmartTitle");
  });

  it("falls back to the formatted tool name for unknown tools", () => {
    expect(getToolSummaryText(createTool({ name: "custom_tool" }))).toBe("Custom_tool");
  });
});

describe("buildProcessSummary", () => {
  it("shows the running tool while streaming", () => {
    const steps: ProcessStep[] = [
      {
        type: "tool",
        tool: createTool({
          id: "tool-0",
          name: "read",
          input: "{\"file_path\":\"/tmp/project/src/main.ts\"}",
          status: "done",
        }),
      },
      {
        type: "tool",
        tool: createTool({
          id: "tool-1",
          name: "bash",
          input: "{\"command\":\"bun run test:unit\"}",
          status: "running",
        }),
      },
    ];

    expect(buildProcessSummary(steps, true)).toBe("正在使用 Bash");
  });

  it("summarizes completed thinking and tool calls", () => {
    const steps: ProcessStep[] = [
      {
        type: "thinking",
        thinking: {
          id: "thinking-1",
          content: "analyzing",
          startedAt: 0,
        },
      },
      {
        type: "tool",
        tool: createTool({ id: "tool-1" }),
      },
      {
        type: "tool",
        tool: createTool({ id: "tool-2", name: "write" }),
      },
    ];

    expect(buildProcessSummary(steps, false)).toBe("已完成分析 · 2 次工具调用");
  });

  it("shows thinking when only thinking is present during streaming", () => {
    const steps: ProcessStep[] = [
      {
        type: "thinking",
        thinking: {
          id: "thinking-1",
          content: "thinking",
          startedAt: 0,
        },
      },
    ];

    expect(buildProcessSummary(steps, true)).toBe("正在思考");
  });

  it("shows completed analysis while the assistant text is still streaming", () => {
    const steps: ProcessStep[] = [
      {
        type: "thinking",
        thinking: {
          id: "thinking-1",
          content: "thinking",
          startedAt: 0,
          completedAt: 10,
        },
      },
    ];

    expect(buildProcessSummary(steps, true)).toBe("已完成分析");
  });

  it("returns an empty summary when there is nothing to report", () => {
    expect(buildProcessSummary([], false)).toBe("");
  });
});
