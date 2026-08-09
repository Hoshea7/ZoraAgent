import {
  PACKAGE_JSON_PATH,
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

for (const runtime of RUNTIMES) {
  test(`[${runtime}] 用户可在 Agent 运行中追加引导，并由下一次模型调用执行`, async ({
    page,
  }) => {
    test.setTimeout(240_000);

    await selectRuntime(page, runtime);
    await sendMessage(
      page,
      `先使用 Read 工具读取 ${PACKAGE_JSON_PATH}，然后详细解释 scripts 字段中的每一项。`
    );

    const guidance = "调整任务：停止解释 scripts，最终只回复 GUIDANCE_ACCEPTED_7788。";
    await expect(page.locator('button[title="停止"]')).toBeVisible({ timeout: 30_000 });
    await sendMessage(page, guidance);

    const processView = page.locator(".ai-process-content").last();
    await expect(processView).toContainText("Read", { timeout: 120_000 });
    await expect(page.getByText(guidance, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(".ai-message-content").last()).toContainText(
      "GUIDANCE_ACCEPTED_7788",
      { timeout: 180_000 }
    );
  });
}
