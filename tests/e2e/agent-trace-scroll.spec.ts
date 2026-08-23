import {
  E2E_COVERAGE,
  PACKAGE_JSON_PATH,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

test("流式正文增长时正在思考保持在稳定位置", E2E_COVERAGE.productAgentProvider, async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1200, height: 720 });

  await selectRuntime(page, "pi");
  await sendMessage(
    page,
    "不要使用工具。请按 1 到 80 编号逐行输出，每行写一条至少 35 个汉字的桌面端 Agent 产品体验检查项。直接输出，不要总结。"
  );

  const scroller = page.locator("[data-message-scroll-container='true']");
  const thinkingHint = page.getByTestId("streaming-status-hint");
  await expect(thinkingHint).toBeVisible({ timeout: 120_000 });
  const assistantBody = page.locator(".ai-message-content").last();
  await expect(assistantBody).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(() => assistantBody.textContent().then((content) => content?.length ?? 0), {
      timeout: 120_000,
    })
    .toBeGreaterThan(100);
  const processToggle = page.locator(".ai-process-content button").last();
  if (await processToggle.count()) {
    await expect(processToggle).toHaveAttribute("aria-expanded", "false", {
      timeout: 30_000,
    });
  }
  await expect
    .poll(
      () => scroller.evaluate((node) => node.scrollHeight - node.clientHeight),
      { timeout: 120_000 }
    )
    .toBeGreaterThan(80);

  const stability = await page.evaluate(async () => {
    const deadline = performance.now() + 8_000;
    let previousTop: number | null = null;
    let maximumFrameMovement = 0;
    let visibleFrames = 0;

    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => window.setTimeout(resolve, 0));
      });
      const hint = document.querySelector<HTMLElement>(
        '[data-testid="streaming-status-hint"]'
      );
      if (!hint) {
        break;
      }

      const top = hint.getBoundingClientRect().top;
      if (previousTop !== null) {
        maximumFrameMovement = Math.max(
          maximumFrameMovement,
          Math.abs(top - previousTop)
        );
      }
      previousTop = top;
      visibleFrames += 1;
    }

    return { maximumFrameMovement, visibleFrames };
  });

  expect(stability.visibleFrames).toBeGreaterThan(60);
  expect(stability.maximumFrameMovement).toBeLessThanOrEqual(2);
});

test("流式输出时用户向上滚动可脱离跟随，并能立即回到最新内容", E2E_COVERAGE.productAgentProvider, async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1200, height: 720 });

  await selectRuntime(page, "pi");
  await sendMessage(
    page,
    `先使用 Read 工具读取 ${PACKAGE_JSON_PATH}。然后按 1 到 30 编号，逐行分析其中的 scripts、dependencies 和 devDependencies；每行都写完整句子，输出全部 30 行。`
  );

  const processView = page.locator(".ai-process-content").last();
  const scroller = page.locator("[data-message-scroll-container='true']");
  await expect(processView).toContainText("Read", { timeout: 120_000 });
  const activityToggle = processView.getByRole("button").first();
  if ((await activityToggle.getAttribute("aria-expanded")) === "true") {
    await activityToggle.click();
  }
  await expect(activityToggle).toHaveAttribute("aria-expanded", "false");
  await page.waitForTimeout(300);
  await expect(activityToggle).toHaveAttribute("aria-expanded", "false");

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
  await expect(page.getByTestId("scroll-to-bottom")).not.toBeVisible();

  // 直接改变 scrollTop 覆盖滚动条拖动路径。
  await scroller.evaluate((node) => {
    node.scrollTop = Math.max(0, node.scrollTop - 600);
    node.dispatchEvent(new Event("scroll"));
  });

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

test("已完成的长消息向下滚动时不会因分块重测发生跳变", E2E_COVERAGE.productAgentProvider, async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1200, height: 720 });

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
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.mouse.wheel(0, -100_000);
    if ((await scroller.evaluate((node) => node.scrollTop)) < 20) break;
  }
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

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.mouse.wheel(0, -100_000);
    if ((await scroller.evaluate((node) => node.scrollTop)) < 20) break;
  }
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
