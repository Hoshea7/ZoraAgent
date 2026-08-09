import {
  PACKAGE_JSON_PATH,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

test("流式输出时用户向上滚动可脱离跟随，并能立即回到最新内容", async ({ page }) => {
  test.setTimeout(240_000);

  await selectRuntime(page, "pi");
  await sendMessage(
    page,
    `先使用 Read 工具读取 ${PACKAGE_JSON_PATH}。然后按 1 到 30 编号，逐行分析其中的 scripts、dependencies 和 devDependencies；每行都写完整句子，输出全部 30 行。`
  );

  const processView = page.locator(".ai-process-content").last();
  const scroller = page.locator("[data-message-scroll-container='true']");
  await expect(processView).toContainText("Read", { timeout: 120_000 });
  await expect(page.getByTestId("streaming-status-hint").last()).toBeVisible({
    timeout: 30_000,
  });

  await expect
    .poll(
      () =>
        scroller.evaluate(
          (node) => node.scrollHeight - node.clientHeight
        ),
      { timeout: 120_000 }
    )
    .toBeGreaterThan(300);

  // 未发生用户向上滚动时，思考和正文增长应持续停留在实时内容底部。
  await expect
    .poll(() =>
      scroller.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop
      )
    )
    .toBeLessThan(60);
  await expect(page.getByTestId("scroll-to-bottom")).not.toBeVisible();

  await scroller.hover();
  await page.mouse.wheel(0, -600);

  await expect
    .poll(
      () =>
        scroller.evaluate(
          (node) => node.scrollHeight - node.clientHeight - node.scrollTop
        ),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(120);

  // 留出多个流式渲染帧，确认 followOutput 没有把 scrollTop 拉回底部。
  // 模型可能很快结束并收起过程区，所以比较滚动位置，不比较会随高度变化的底部距离。
  const scrollTopAfterLeaving = await scroller.evaluate((node) => node.scrollTop);
  await page.waitForTimeout(150);
  const scrollTopAfterStreaming = await scroller.evaluate((node) => node.scrollTop);
  expect(scrollTopAfterStreaming).toBeLessThanOrEqual(scrollTopAfterLeaving + 20);

  const returnButton = page.getByTestId("scroll-to-bottom");
  await expect(returnButton).toBeVisible();
  await returnButton.click();
  await expect
    .poll(() =>
      scroller.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop
      )
    )
    .toBeLessThan(60);
});
