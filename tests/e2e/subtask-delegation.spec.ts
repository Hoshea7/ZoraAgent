import {
  expect,
  loadRealProviders,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

test.describe("subtask delegation", () => {
  test("父 Agent 获取超过八千字符的完整子任务结果", async ({
    page,
    scratchDir,
  }) => {
    test.setTimeout(300_000);
    const resultPath = path.join(scratchDir, "long-subtask-result.txt");
    const headMarker = `LONG_RESULT_HEAD_${randomUUID()}`;
    const tailMarker = `LONG_RESULT_TAIL_${randomUUID()}`;
    const lines = Array.from(
      { length: 420 },
      (_, index) => `LINE_${String(index + 1).padStart(4, "0")}_${"X".repeat(18)}`
    );
    await writeFile(
      resultPath,
      [headMarker, ...lines, tailMarker].join("\n"),
      "utf8"
    );
    await selectRuntime(page, "pi");

    await sendMessage(
      page,
      [
        "使用 delegate_agent 创建一个 explore 子任务，title 必须是 Long result child。",
        `task 是：使用 Read 工具读取 ${resultPath}，最终回复逐字输出文件全部内容，不使用代码块，不省略任何行。`,
        "expectedOutput 是：直接逐字返回文件完整内容，不附加总结或说明。",
        "创建后使用 wait_for_delegations 等待完成，再调用 get_delegation_results 获取该 delegationId 的结果。",
        "父会话不要直接读取文件。最终回复只报告结果的第一行和最后一行。",
      ].join("\n")
    );

    const child = page.getByText("Long result child", { exact: true });
    await expect(child).toBeVisible({ timeout: 90_000 });
    const parentResult = page.locator(".ai-message-content").last();
    await expect(parentResult).toContainText(tailMarker, { timeout: 180_000 });
    await expect(parentResult).toContainText(headMarker);
    await expect(page.locator(".ai-process-content")).toContainText(
      /get_delegation_results/i,
      { timeout: 30_000 }
    );

    await child.click();
    const childResult = page.locator(".ai-message-content").last();
    await expect(childResult).toContainText(headMarker, { timeout: 30_000 });
    await expect(childResult).toContainText(tailMarker);
    expect((await childResult.textContent())?.length ?? 0).toBeGreaterThan(8_000);
  });

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

    const childRow = page.getByText("Package inspector", { exact: true });
    await expect(childRow).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("permission-banner")).toHaveCount(0);
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

    await parentRow.getByRole("button", { name: /操作菜单/ }).click();
    await page.getByRole("menuitem", { name: "置顶", exact: true }).click();
    const pinnedSection = page.locator("section").filter({
      has: page.getByRole("button", { name: "置顶", exact: true }),
    });
    await expect(pinnedSection.getByText("Package inspector", { exact: true })).toBeVisible();
    await expect(page.getByText("Package inspector", { exact: true })).toHaveCount(1);
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
    await expect(page.getByText("Question child", { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText("Read child", { exact: true })).toBeVisible({
      timeout: 90_000,
    });

    await expect(allow).toBeVisible({ timeout: 60_000 });
    await allow.click();
    const finalResponse = page.locator(".ai-message-content").last();
    await expect(finalResponse).toContainText("PARALLEL_HITL_OK", {
      timeout: 150_000,
    });
    await expect(finalResponse).toContainText("ALPHA-42");
    await expect(finalResponse).toContainText(/zora/i);
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
    const child = page.getByText("Cross provider child", { exact: true });
    await expect(child).toBeVisible({ timeout: 120_000 });
    await expect(page.locator(".ai-message-content").last()).toContainText(
      /CROSS_PROVIDER_OK.*zora|zora.*CROSS_PROVIDER_OK/is,
      { timeout: 150_000 }
    );

    await child.click();
    await expect(page.getByRole("button", { name: "切换模型与推理强度" })).toContainText(
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

  test("用户处理子会话授权并独立控制持久化权限模式", async ({ page, scratchDir }) => {
    test.setTimeout(180_000);
    const bashResultPath = path.join(scratchDir, "child-bash-result.txt");
    const smartWritePath = path.join(scratchDir, "child-smart-write.txt");
    const childApprovedPath = path.join(scratchDir, "child-approved-result.txt");
    const bashCommand = `node -e ${JSON.stringify(
      `const fs=require('fs');const crypto=require('crypto');const value=crypto.randomUUID();fs.writeFileSync(${JSON.stringify(
        bashResultPath
      )},value);console.log(value)`
    )}`;
    await selectRuntime(page, "pi");
    await sendMessage(
      page,
      [
        "使用 delegate_agent 创建 title 为 Permission child 的 explore 子任务。",
        `task 为：必须调用 Bash 原样执行以下命令，读取命令真实输出后回复 CHILD_PERMISSION_DONE 和输出值：${bashCommand}`,
        "创建成功后直接回复 CHILD_STARTED，不要调用 wait_for_delegations，也不要代替用户处理子任务权限。",
      ].join("\n")
    );
    const allow = page.getByRole("button", { name: "允许", exact: true });
    const child = page.getByText("Permission child", { exact: true });
    await expect(child).toBeVisible({
      timeout: 60_000,
    });
    const permissionBanner = page.getByTestId("permission-banner");
    await expect(permissionBanner).toContainText(/子任务.*Permission child/i, {
      timeout: 60_000,
    });
    await expect(permissionBanner).toContainText("node -e");
    await expect(allow).toBeVisible();

    await child.click();
    await expect(permissionBanner).toContainText("node -e");
    await expect(allow).toBeVisible();

    await page.getByTestId("parent-session-row").click();
    await expect(permissionBanner).toContainText(/子任务.*Permission child/i);
    await expect.poll(async () => readFile(bashResultPath, "utf8").catch(() => ""), {
      timeout: 3_000,
    }).toBe("");
    await child.click();
    expect((await page.locator(".ai-message-content").allTextContents()).join("\n"))
      .not.toContain("CHILD_PERMISSION_DONE");
    await page.getByTestId("parent-session-row").click();
    await allow.click();
    await expect(permissionBanner).toBeHidden();

    await child.click();
    await expect(permissionBanner).toBeHidden();
    await expect(page.locator(".ai-process-content")).toContainText(/bash/i, {
      timeout: 60_000,
    });
    await expect.poll(async () => readFile(bashResultPath, "utf8").catch(() => ""), {
      timeout: 60_000,
    }).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    const bashResult = await readFile(bashResultPath, "utf8");
    await expect(page.locator(".ai-message-content").last()).toContainText(
      bashResult,
      { timeout: 60_000 }
    );

    const permissionMode = page.getByRole("button", {
      name: "当前权限模式：Ask",
    });
    await permissionMode.click();
    await expect(
      page.getByRole("button", { name: "当前权限模式：Smart" })
    ).toBeVisible();

    await sendMessage(
      page,
      `必须使用 Write 工具把 SMART_MODE_WRITE_OK 写入 ${smartWritePath}，再读取该文件并回复内容。`
    );
    await expect.poll(async () => readFile(smartWritePath, "utf8").catch(() => ""), {
      timeout: 60_000,
    }).toBe("SMART_MODE_WRITE_OK");
    await expect(permissionBanner).toBeHidden();
    await expect(page.locator(".ai-process-content").last()).toContainText(/write/i);

    await page.getByRole("button", { name: "当前权限模式：Smart" }).click();
    await expect(
      page.getByRole("button", { name: "当前权限模式：YOLO" })
    ).toBeVisible();

    await page.reload();
    await expect(child).toBeVisible({ timeout: 45_000 });
    await child.click();
    await expect(
      page.getByRole("button", { name: "当前权限模式：YOLO" })
    ).toBeVisible();

    await page.getByTestId("parent-session-row").click();
    await expect(
      page.getByRole("button", { name: "当前权限模式：Ask" })
    ).toBeVisible();

    await child.click();
    await page.getByRole("button", { name: "当前权限模式：YOLO" }).click();
    await sendMessage(
      page,
      `必须调用 Bash 执行 node -e ${JSON.stringify(
        `require('fs').writeFileSync(${JSON.stringify(childApprovedPath)},'CHILD_APPROVED_OK')`
      )}，完成后回复 CHILD_APPROVAL_DONE。`
    );
    await expect(permissionBanner).toContainText("node -e", { timeout: 60_000 });
    await allow.click();
    await expect.poll(async () => readFile(childApprovedPath, "utf8").catch(() => ""), {
      timeout: 60_000,
    }).toBe("CHILD_APPROVED_OK");
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
    const child = page.getByText("Stoppable child", { exact: true });
    await expect(child).toBeVisible({ timeout: 120_000 });
    await child.click();
    await expect(page.locator(".ai-process-content")).toContainText(
      "AskUserQuestion",
      { timeout: 120_000 }
    );
    await expect(page.getByText("Zora 需要你的回答", { exact: true })).toBeVisible();
    await expect(page.getByText("请提供继续代号", { exact: true })).toBeVisible();
    const stopButton = page.locator('button[title="停止"]');
    await expect(stopButton).toBeVisible();
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

  test("用户按子任务或父子整组粒度归档并恢复", async ({ page }) => {
    test.setTimeout(180_000);
    await selectRuntime(page, "pi");
    await page.getByRole("button", { name: "切换模型与推理强度" }).click();
    const reasoningSlider = page.getByRole("slider", { name: "推理强度" });
    await reasoningSlider.focus();
    await reasoningSlider.press("Home");
    await page.keyboard.press("Escape");
    await sendMessage(
      page,
      [
        "使用 delegate_agent 创建 title 为 Archive child 的 explore 子任务。",
        "task 为：必须调用 Bash 执行 cat package.json | head -20，读取结果后报告 name。",
        "使用 wait_for_delegations 等待完成，最终回复 ARCHIVE_READY。",
      ].join("\n")
    );

    const child = page
      .getByRole("complementary")
      .getByText("Archive child", { exact: true });
    const parentSidebar = page
      .getByRole("complementary")
      .getByText("使用 delegate_agent 创建 title 为 Archive child 的…", {
        exact: true,
      });
    await expect(child).toBeVisible({ timeout: 90_000 });
    const permissionBanner = page.getByTestId("permission-banner");
    await expect(permissionBanner).toContainText(/子任务.*Archive child/i, {
      timeout: 60_000,
    });
    await expect(permissionBanner).toContainText("cat package.json");
    expect((await page.locator(".ai-message-content").allTextContents()).join("\n"))
      .not.toContain("ARCHIVE_READY");
    const permissionDeadline = Date.now() + 90_000;
    while (Date.now() < permissionDeadline) {
      const assistantText = (
        await page.locator(".ai-message-content").allTextContents()
      ).join("\n");
      if (assistantText.includes("ARCHIVE_READY")) break;
      if (await permissionBanner.isVisible().catch(() => false)) {
        await page.getByRole("button", { name: "始终允许", exact: true }).click();
      }
      const running = await page.locator('button[title="停止"]').isVisible().catch(() => false);
      if (!running) {
        throw new Error("父会话已结束，但没有输出 ARCHIVE_READY。\n" + assistantText);
      }
      await page.waitForTimeout(250);
    }
    expect((await page.locator(".ai-message-content").allTextContents()).join("\n"))
      .toContain("ARCHIVE_READY");

    const openChildMenu = async () => {
      await page
        .getByRole("button", { name: "打开Archive child的操作菜单", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "归档", exact: true }).click();
    };
    const openArchivedSettings = async () => {
      const archivedHeading = page.getByRole("heading", { name: "已归档会话" });
      if (await archivedHeading.isVisible().catch(() => false)) return;
      await page
        .getByRole("complementary")
        .getByRole("button", { name: "设置", exact: true })
        .click();
      await page.getByRole("button", { name: "已归档会话", exact: true }).click();
      await expect(archivedHeading).toBeVisible();
    };

    await openChildMenu();
    await expect(page.getByRole("dialog", { name: "归档子任务？" })).toBeVisible();
    await page.getByRole("button", { name: "仅归档此子任务" }).click();
    await expect(child).toBeHidden();
    await expect(parentSidebar).toBeVisible();

    await openArchivedSettings();
    await expect(page.getByText("Archive child", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "恢复", exact: true }).click();
    await page.getByRole("button", { name: "确认恢复", exact: true }).click();
    await expect(child).toBeVisible({ timeout: 30_000 });

    await openChildMenu();
    await page.getByRole("button", { name: "全部归档", exact: true }).click();
    await expect(child).toBeHidden();
    await expect(parentSidebar).toBeHidden();

    await openArchivedSettings();
    await expect(page.getByText("Archive child", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "恢复", exact: true }).first().click();
    await page.getByRole("button", { name: "确认恢复", exact: true }).click();
    await expect(parentSidebar).toBeVisible({ timeout: 30_000 });
    await expect(child).toBeVisible();
  });
});
