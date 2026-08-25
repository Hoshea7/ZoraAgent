import {
  E2E_COVERAGE,
  RUNTIMES,
  expect,
  expectAssistantTextUntilSettled,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

for (const runtime of RUNTIMES) {
  test(`[${runtime}] Agent 可用 TodoWrite 记录多步骤任务`, E2E_COVERAGE.agentProvider, async ({ page }) => {
    test.setTimeout(180_000);
    const token = `TODO_FINISHED_${runtime.toUpperCase()}_7788`;

    await selectRuntime(page, runtime);
    const previousAssistantCount = await page
      .locator("[data-assistant-message='true']")
      .count();
    await sendMessage(
      page,
      [
        "必须调用 TodoWrite 工具一次，传入两个任务。",
        "第一个任务 content 为「读取输入」、status 为 completed。",
        "第二个任务 content 为「输出结果」、status 为 in_progress。",
        `工具调用完成后只回复 ${token}。`,
      ].join("")
    );

    await expectAssistantTextUntilSettled(
      page,
      token,
      previousAssistantCount,
      150_000,
    );
    const process = page.locator(".ai-process-content").last();
    const processToggle = process.getByRole("button").first();
    await expect(processToggle).toContainText(/工具调用/, { timeout: 5_000 });
    if ((await processToggle.getAttribute("aria-expanded")) !== "true") {
      await processToggle.click();
    }
    await expect(process.getByTestId("agent-activity")).toContainText(
      "TodoWrite",
      { timeout: 5_000 },
    );
    await process.getByRole("button", { name: /^TodoWrite(?:\s|$)/ }).click();
    await expect(process).toContainText(/读取输入/, { timeout: 5_000 });
    await expect(process).toContainText(/输出结果/, { timeout: 5_000 });
  });
}
