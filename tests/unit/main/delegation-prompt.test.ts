import {
  buildDelegationPrompt,
  buildDelegationTaskWithSharedContext,
} from "@/main/delegation/prompt";

describe("delegation prompt", () => {
  it("uses the default output guidance", () => {
    const prompt = buildDelegationPrompt({
      parentSessionId: "parent-1",
      delegationId: "child-1",
      role: "explore",
      task: "Inspect package.json",
    });

    expect(prompt).toContain("你由父 Agent 会话 parent-1 委派创建，委派 ID 为 child-1");
    expect(prompt).toContain("如需修改文件，保持改动最小");
    expect(prompt).toContain("## 子任务\nInspect package.json");
    expect(prompt).toContain(
      "## 输出要求\n最终回复请包含：关键发现、已执行操作、验证结果、剩余风险或建议。"
    );
  });

  it("lets a task-specific expected output replace the default guidance", () => {
    const prompt = buildDelegationPrompt({
      parentSessionId: "parent-1",
      delegationId: "child-1",
      role: "review",
      task: "Review the patch",
      expectedOutput: "  直接返回问题清单。  ",
    });

    expect(prompt).toContain("## 输出要求\n直接返回问题清单。");
    expect(prompt).not.toContain("关键发现、已执行操作");
  });

  it("labels batch shared context separately from the child task", () => {
    expect(
      buildDelegationTaskWithSharedContext({
        sharedContext: "  Parent context  ",
        task: "  Child task  ",
      })
    ).toBe("共享背景：\nParent context\n\n子任务：\nChild task");
  });
});
