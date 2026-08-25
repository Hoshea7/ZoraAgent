import {
  E2E_COVERAGE,
  RUNTIMES,
  expect,
  expectAssistantTextUntilSettled,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

async function selectYolo(page: Parameters<typeof selectRuntime>[0]): Promise<void> {
  const modeButton = page.getByRole("button", { name: /^当前权限模式：/ });
  await expect(modeButton).toBeVisible();
  while (!(await modeButton.getAttribute("aria-label"))?.includes("YOLO")) {
    await modeButton.click();
    await expect(modeButton).toBeEnabled();
  }
}

for (const runtime of RUNTIMES) {
  test(`[${runtime}] 用户可在 Agent 运行中追加引导，并由下一次模型调用执行`, E2E_COVERAGE.productAgentProvider, async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await selectRuntime(page, runtime);
    await selectYolo(page);
    await sendMessage(
      page,
      '必须使用 Bash 原样执行 node -e "setTimeout(() => console.log(\'GUIDANCE_WINDOW_READY\'), 4000)"，拿到输出后只回复 INITIAL_TASK_DONE。'
    );

    const stopButton = page.locator('button[title="停止"]');
    await expect(stopButton).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".ai-process-content").first()).toContainText(
      "Bash",
      { timeout: 15_000 },
    );
    await expect(stopButton).toBeVisible();

    const guidance = "调整任务：停止解释 scripts，最终只回复 GUIDANCE_ACCEPTED_7788。";
    const previousAssistantCount = await page
      .locator("[data-assistant-message='true']")
      .count();
    await sendMessage(page, guidance);
    await expect(page.getByText(guidance, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const guidanceMessage = page.locator("article").filter({ hasText: guidance }).last();
    const guidedResponse = await expectAssistantTextUntilSettled(
      page,
      "GUIDANCE_ACCEPTED_7788",
      previousAssistantCount
    );

    // MessageList 消息按顺序渲染，用户消息与助手消息是直接兄弟节点。
    // 通过实际屏幕位置验证引导开始后创建的 Assistant Turn 位于用户消息下方。
    const [guidanceBox, responseBox] = await Promise.all([
      guidanceMessage.boundingBox(),
      guidedResponse.boundingBox(),
    ]);
    expect(guidanceBox).not.toBeNull();
    expect(responseBox).not.toBeNull();
    expect(responseBox!.y).toBeGreaterThan(guidanceBox!.y);
  });
}

test("[pi] 用户发送引导后立即停止，下一轮仍能读取该消息", E2E_COVERAGE.productAgentProvider, async ({ page }) => {
  test.setTimeout(150_000);

  await selectRuntime(page, "pi");
  await selectYolo(page);
  await sendMessage(
    page,
    '必须使用 Bash 原样执行 node -e "setTimeout(() => console.log(\'INTERRUPT_WINDOW_READY\'), 10000)"，拿到输出后只回复 INITIAL_TASK_DONE。'
  );

  const stopButton = page.locator('button[title="停止"]');
  await expect(stopButton).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".ai-process-content").last()).toContainText("Bash", {
    timeout: 15_000,
  });

  const interruptedGuidance =
    "停止后不要继续原任务。下一条消息询问口令时，只回复 INTERRUPTED_GUIDANCE_7788。";
  await sendMessage(page, interruptedGuidance);
  await expect(page.getByText(interruptedGuidance, { exact: true })).toBeVisible();
  await stopButton.click();
  await expect(stopButton).not.toBeVisible({ timeout: 60_000 });

  const previousAssistantCount = await page
    .locator("[data-assistant-message='true']")
    .count();
  await sendMessage(page, "我刚才指定的口令是什么？只回复该口令。");
  await expectAssistantTextUntilSettled(
    page,
    "INTERRUPTED_GUIDANCE_7788",
    previousAssistantCount,
    90_000,
  );
});
