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
      `请对 ${PACKAGE_JSON_PATH} 做一次长程分析：先读取文件，再逐项分析全部 scripts、dependencies 和 devDependencies 的用途、风险与优化建议，最后形成完整报告。`
    );

    await expect(page.locator('button[title="停止"]')).toBeVisible({ timeout: 30_000 });
    // 首个 thinking/text token 到达后立即引导，保证消息进入仍在运行的 Agent Turn。
    await expect(
      page.locator(".ai-process-content, .ai-message-content").first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('button[title="停止"]')).toBeVisible();

    const guidance = "调整任务：停止解释 scripts，最终只回复 GUIDANCE_ACCEPTED_7788。";
    await sendMessage(page, guidance);
    await expect(page.getByText(guidance, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const guidanceMessage = page.locator("article").filter({ hasText: guidance }).last();
    const guidedResponse = page
      .locator(".ai-message-content")
      .filter({ hasText: "GUIDANCE_ACCEPTED_7788" })
      .last();
    await expect(guidedResponse).toContainText(
      "GUIDANCE_ACCEPTED_7788",
      { timeout: 180_000 }
    );

    // MessageList 使用虚拟列表后，用户消息与助手消息不再是直接兄弟节点。
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

test("[pi] 用户发送引导后立即停止，下一轮仍能读取该消息", async ({ page }) => {
  test.setTimeout(240_000);

  await selectRuntime(page, "pi");
  await sendMessage(
    page,
    `先使用 Read 工具读取 ${PACKAGE_JSON_PATH}，然后详细解释所有 dependencies。`
  );

  const stopButton = page.locator('button[title="停止"]');
  await expect(stopButton).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".ai-process-content").last()).toContainText("Read", {
    timeout: 120_000,
  });

  const interruptedGuidance =
    "记住这个停止前要求：下一次继续时只回复 INTERRUPTED_GUIDANCE_7788。";
  await sendMessage(page, interruptedGuidance);
  await expect(page.getByText(interruptedGuidance, { exact: true })).toBeVisible();
  await stopButton.click();
  await expect(stopButton).not.toBeVisible({ timeout: 60_000 });

  await sendMessage(page, "继续执行我停止前发出的要求。");
  await expect(page.locator(".ai-message-content").last()).toContainText(
    "INTERRUPTED_GUIDANCE_7788",
    { timeout: 180_000 }
  );
});
