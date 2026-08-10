import {
  expect,
  loadRealProviders,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";
import { existsSync } from "node:fs";
import path from "node:path";

test.describe("subtask delegation", () => {
  test("用户委派只读调查，查看子会话，并在父会话收到结果", async ({ page }) => {
    test.setTimeout(240_000);
    await selectRuntime(page, "pi");

    await sendMessage(
      page,
      [
        "使用 delegate_agent 创建一个 explore 子任务。",
        "title 必须是 Package inspector。",
        "task 是：读取当前项目 package.json，报告 name 字段。",
        "创建后使用 wait_for_delegations 等待该 delegationId。",
        "收到结果后在最终回复中写出 SUBTASK_RESULT_OK 和 package name。",
      ].join("\n")
    );

    const allow = page.getByRole("button", { name: "允许", exact: true });
    await expect(allow).toBeVisible({ timeout: 60_000 });
    await allow.click();

    const childRow = page.getByText("Package inspector", { exact: true });
    await expect(childRow).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("subtask-status")).toContainText(/运行中|已完成/);

    const collapseChildren = page.getByRole("button", {
      name: "收起子任务",
      exact: true,
    });
    await expect(collapseChildren).toBeVisible();
    await collapseChildren.click();
    await expect(childRow).toBeHidden();

    const expandChildren = page.getByRole("button", {
      name: "展开子任务",
      exact: true,
    });
    await expect(expandChildren).toBeVisible();
    await expandChildren.click();
    await expect(childRow).toBeVisible();

    await childRow.click();
    await expect(page.locator(".ai-process-content")).toContainText(/read/i, {
      timeout: 120_000,
    });
    await expect(page.locator(".ai-message-content").last()).toContainText(/zora/i, {
      timeout: 120_000,
    });

    const parentRow = page.getByTestId("parent-session-row");
    await parentRow.click();
    await expect(page.locator(".ai-process-content")).toContainText(
      /delegate_agent/i,
      { timeout: 60_000 }
    );
    await expect(page.locator(".ai-message-content").last()).toContainText(
      /SUBTASK_RESULT_OK.*zora|zora.*SUBTASK_RESULT_OK/is,
      { timeout: 120_000 }
    );
    await expect(page.getByTestId("subtask-progress")).toHaveText("1/1");
  });

  test("用户启动并行子任务，父 Agent 代答子任务提问后汇总", async ({ page }) => {
    test.setTimeout(300_000);
    await selectRuntime(page, "pi");
    await sendMessage(
      page,
      [
        "必须使用 delegate_agents 一次创建两个 explore 子任务。",
        "第一个 title 为 Question child，task 为：必须调用 AskUserQuestion 询问‘确认代号是什么？’，收到回答后原样报告代号。",
        "第二个 title 为 Read child，task 为：读取项目根目录 package.json 并报告 name。",
        "用 wait_for_delegations 等待。出现 needs_input 后必须调用 respond_to_delegation，回答问题索引 0 为 ALPHA-42，然后继续等待全部完成。",
        "最终回复必须包含 PARALLEL_HITL_OK、ALPHA-42 和 zora。",
      ].join("\n")
    );

    const allow = page.getByRole("button", { name: "允许", exact: true });
    await expect(allow).toBeVisible({ timeout: 60_000 });
    await allow.click();
    await expect(page.getByText("Question child", { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText("Read child", { exact: true })).toBeVisible({
      timeout: 90_000,
    });

    await expect(allow).toBeVisible({ timeout: 120_000 });
    await allow.click();
    await expect(page.locator(".ai-message-content").last()).toContainText(
      /PARALLEL_HITL_OK.*ALPHA-42.*zora|PARALLEL_HITL_OK.*zora.*ALPHA-42/is,
      { timeout: 150_000 }
    );
    await expect(page.getByTestId("subtask-progress")).toHaveText("2/2");
  });

  test("用户选择另一 Provider 创建子任务，并在子会话继续对话", async ({ page }) => {
    test.setTimeout(300_000);
    const providers = await loadRealProviders();
    const current = providers.find((provider) => provider.isDefault)!;
    const target = providers.find(
      (provider) =>
        provider.id !== current.id && provider.apiKey && provider.modelId
    );
    test.skip(!target, "需要至少两个已启用的真实 Provider");
    await selectRuntime(page, "pi");

    await sendMessage(
      page,
      [
        "先调用 list_available_models 确认候选。",
        "然后使用 delegate_agent 创建 title 为 Cross provider child 的 explore 子任务。",
        `必须指定 providerId=${target!.id}、modelId=${target!.modelId}、agentRuntimeType=claude。`,
        "task 为：读取项目 package.json 并报告 name。创建后等待完成。",
        "最终回复包含 CROSS_PROVIDER_OK 和 zora。",
      ].join("\n")
    );
    const allow = page.getByRole("button", { name: "允许", exact: true });
    await expect(allow).toBeVisible({ timeout: 90_000 });
    await allow.click();
    const child = page.getByText("Cross provider child", { exact: true });
    await expect(child).toBeVisible({ timeout: 120_000 });
    await expect(page.locator(".ai-message-content").last()).toContainText(
      /CROSS_PROVIDER_OK.*zora|zora.*CROSS_PROVIDER_OK/is,
      { timeout: 150_000 }
    );

    await child.click();
    await expect(page.getByRole("button", { name: "切换当前模型渠道" })).toContainText(
      target!.modelId,
      { timeout: 30_000 }
    );
    await sendMessage(
      page,
      "基于刚才已经读取的内容继续回答。回复必须包含 CONTINUE_OK 和 package name。"
    );
    await expect(page.locator(".ai-message-content").last()).toContainText(
      /CONTINUE_OK.*zora|zora.*CONTINUE_OK/is,
      { timeout: 150_000 }
    );
    await expect(page.getByTestId("subtask-status")).toContainText("已完成");
  });

  test("只读子任务无法写入项目文件", async ({ page }) => {
    test.setTimeout(240_000);
    const markerPath = path.join(process.cwd(), "delegation-write-denied.marker");
    expect(existsSync(markerPath)).toBe(false);
    await selectRuntime(page, "pi");
    await sendMessage(
      page,
      [
        "使用 delegate_agent 创建 title 为 Readonly guard 的 explore 子任务。",
        "task 为：尝试在项目根目录创建 delegation-write-denied.marker，然后明确报告是否成功。",
        "等待子任务结束，最终回复必须包含 READONLY_GUARD_OK。",
      ].join("\n")
    );
    const allow = page.getByRole("button", { name: "允许", exact: true });
    await expect(allow).toBeVisible({ timeout: 60_000 });
    await allow.click();
    await expect(page.getByText("Readonly guard", { exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.locator(".ai-message-content").last()).toContainText(
      "READONLY_GUARD_OK",
      { timeout: 150_000 }
    );
    expect(existsSync(markerPath)).toBe(false);
  });

  test("用户停止阻塞中的子任务后，可以在同一子会话继续", async ({ page }) => {
    test.setTimeout(300_000);
    await selectRuntime(page, "pi");
    await sendMessage(
      page,
      [
        "使用 delegate_agent 创建 title 为 Stoppable child 的 explore 子任务。",
        "task 为：调用 AskUserQuestion 询问‘请提供继续代号’，并等待用户回答。",
        "创建成功后立即结束父会话回复，不要等待子任务。",
      ].join("\n")
    );
    const allow = page.getByRole("button", { name: "允许", exact: true });
    await expect(allow).toBeVisible({ timeout: 60_000 });
    await allow.click();
    const child = page.getByText("Stoppable child", { exact: true });
    await expect(child).toBeVisible({ timeout: 120_000 });
    await child.click();
    const stopButton = page.locator('button[title="停止"]');
    await expect(stopButton).toBeVisible({ timeout: 90_000 });
    await stopButton.click();
    await expect(page.getByTestId("subtask-status")).toContainText("已停止", {
      timeout: 60_000,
    });
    await sendMessage(page, "继续执行。不要再提问，只回复 SUBTASK_CONTINUED_OK。");
    await expect(page.locator(".ai-message-content").last()).toContainText(
      "SUBTASK_CONTINUED_OK",
      { timeout: 150_000 }
    );
    await expect(page.getByTestId("subtask-status")).toContainText("已完成");
  });
});
