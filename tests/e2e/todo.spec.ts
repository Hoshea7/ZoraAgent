import {
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

for (const runtime of RUNTIMES) {
  test(`[${runtime}] Agent 可用 TodoWrite 记录多步骤任务`, async ({ page }) => {
    test.setTimeout(180_000);
    const token = `TODO_FINISHED_${runtime.toUpperCase()}_7788`;

    await selectRuntime(page, runtime);
    await sendMessage(
      page,
      [
        "必须调用 TodoWrite 工具一次，传入两个任务。",
        "第一个任务 content 为「读取输入」、status 为 completed。",
        "第二个任务 content 为「输出结果」、status 为 in_progress。",
        `工具调用完成后只回复 ${token}。`,
      ].join("")
    );

    const process = page.locator(".ai-process-content");
    await expect(process).toContainText("TodoWrite", { timeout: 120_000 });
    await process.getByRole("button", { name: /^TodoWrite(?:\s|$)/ }).click();
    await expect(process).toContainText(/读取输入|输出结果/, { timeout: 120_000 });
    await expect(page.locator(".ai-message-content").last()).toContainText(
      token,
      { timeout: 120_000 }
    );
  });
}
