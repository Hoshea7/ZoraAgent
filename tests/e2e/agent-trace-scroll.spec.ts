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
  const liveTurnStatus = page.getByTestId("live-turn-status");
  await expect(liveTurnStatus).toBeVisible();

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
    .toBeLessThan(6);
  const liveStatusPosition = await liveTurnStatus.evaluate((status) => {
    const scrollNode = status.closest("[data-message-scroll-container='true']");
    if (!(scrollNode instanceof HTMLElement)) {
      throw new Error("Message scroll container not found");
    }
    const statusRect = status.getBoundingClientRect();
    const scrollerRect = scrollNode.getBoundingClientRect();
    return {
      bottomGap: scrollerRect.bottom - statusRect.bottom,
      fullyVisible: statusRect.top >= scrollerRect.top && statusRect.bottom <= scrollerRect.bottom,
    };
  });
  expect(liveStatusPosition.fullyVisible).toBe(true);
  expect(liveStatusPosition.bottomGap).toBeGreaterThanOrEqual(12);
  expect(liveStatusPosition.bottomGap).toBeLessThan(60);
  await expect(page.getByTestId("scroll-to-bottom")).not.toBeVisible();

  // 没有造成消息列表位移的滚轮输入不能误判为用户已离开实时区域。
  await processView.dispatchEvent("wheel", { deltaY: -80 });
  await page.waitForTimeout(150);
  await expect
    .poll(() =>
      scroller.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop
      )
    )
    .toBeLessThan(6);
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
    .toBeLessThan(6);
});

test("已完成的长消息向下滚动时不会因分块重测发生跳变", async ({ page }) => {
  test.setTimeout(240_000);

  await selectRuntime(page, "pi");
  await sendMessage(
    page,
    `读取 ${PACKAGE_JSON_PATH}，输出 30 行编号分析，每行说明一个字段或脚本的作用，完成后停止。`
  );

  const scroller = page.locator("[data-message-scroll-container='true']");
  await expect(page.locator(".ai-message-content").last()).toContainText("1.", {
    timeout: 120_000,
  });
  await expect(page.locator('button[title="停止"]')).not.toBeVisible({
    timeout: 120_000,
  });

  await expect
    .poll(() => scroller.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(300);

  await scroller.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(20);

  const returnButton = page.getByTestId("scroll-to-bottom");
  await expect(returnButton).toBeVisible();
  await returnButton.click();
  await expect
    .poll(() =>
      scroller.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop
      )
    )
    .toBeLessThan(6);

  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(20);

  let previousScrollTop = 0;
  for (let index = 0; index < 8; index += 1) {
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(40);
    const nextScrollTop = await scroller.evaluate((node) => node.scrollTop);
    expect(nextScrollTop).toBeGreaterThanOrEqual(previousScrollTop - 2);
    previousScrollTop = nextScrollTop;
  }
});
