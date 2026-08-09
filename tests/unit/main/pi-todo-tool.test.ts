import { createPiTodoTool } from "@/main/runtime/pi-todo-tool";

describe("createPiTodoTool", () => {
  it("returns the complete task state to the Agent", async () => {
    const tool = createPiTodoTool();
    const result = await tool.execute(
      "todo-1",
      {
        todos: [
          { content: "读取输入", status: "completed" },
          { content: "输出结果", status: "in_progress" },
        ],
      },
      new AbortController().signal,
      () => undefined
    );

    expect(result).toEqual({
      content: [{
        type: "text",
        text: "Todos updated:\n1. [completed] 读取输入\n2. [in_progress] 输出结果",
      }],
      details: { todoCount: 2 },
    });
  });

  it("rejects malformed calls instead of accepting an empty list", async () => {
    const tool = createPiTodoTool();

    await expect(tool.execute(
      "todo-2",
      {},
      new AbortController().signal,
      () => undefined
    )).rejects.toThrow("TodoWrite 需要 todos 数组");
  });
});
