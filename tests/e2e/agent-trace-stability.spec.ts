import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  E2E_COVERAGE,
  expect,
  selectModel,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

test(
  "展开思考与正文流式增长保持连续",
  E2E_COVERAGE.productAgentProvider,
  async ({ page, scratchDir }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1200, height: 720 });
    const fixturePath = path.join(scratchDir, "layout-stability-notes.txt");
    await writeFile(
      fixturePath,
      "流式界面测试资料。内容仅用于触发一次 Read 工具调用，没有项目数据。",
      "utf8"
    );

    await selectRuntime(page, "pi");
    await selectModel(page, "glm-5.2");
    await sendMessage(
      page,
      `请先使用 Read 工具读取 ${fixturePath}，然后详细分析桌面端对话产品在长时间流式生成时可能出现的布局稳定性问题，最后列出 20 条完整结论。`
    );

    const processView = page.locator(".ai-process-content").last();
    await expect(processView).toBeVisible({ timeout: 120_000 });
    const processToggle = processView.getByRole("button").first();
    if ((await processToggle.getAttribute("aria-expanded")) !== "true") {
      await processToggle.click();
    }

    const thinkingToggle = processView
      .getByRole("button", { name: /思考/ })
      .last();
    await expect(thinkingToggle).toBeVisible({ timeout: 120_000 });
    const liveTurnStatus = page.getByTestId("live-turn-status");
    await expect(liveTurnStatus).toBeVisible();
    await liveTurnStatus.evaluate((status) => {
      const deadline = performance.now() + 1_500;
      let previousTop = status.getBoundingClientRect().top;
      let maximumUpwardFrameMovement = 0;
      let minimumVisibleContentSeparation = Number.POSITIVE_INFINITY;
      let worstFrame = "";
      let visibleFrames = 0;

      const measureFrame = () => {
        if (!status.isConnected) {
          return;
        }
        const nextTop = status.getBoundingClientRect().top;
        maximumUpwardFrameMovement = Math.max(
          maximumUpwardFrameMovement,
          Math.max(0, previousTop - nextTop)
        );
        const viewport = document.querySelector<HTMLElement>(
          "[data-message-scroll-container='true']"
        );
        const precedingContent = status.previousElementSibling as HTMLElement | null;
        if (viewport && precedingContent) {
          const viewportBottom = viewport.getBoundingClientRect().bottom;
          const visibleContentBottom = Math.min(
            precedingContent.getBoundingClientRect().bottom,
            viewportBottom
          );
          const separation = nextTop - visibleContentBottom;
          if (separation < minimumVisibleContentSeparation) {
            minimumVisibleContentSeparation = separation;
            const viewportRect = viewport.getBoundingClientRect();
            const contentRect = precedingContent.getBoundingClientRect();
            worstFrame = JSON.stringify({
              separation,
              statusTop: nextTop,
              contentBottom: contentRect.bottom,
              viewportTop: viewportRect.top,
              viewportBottom: viewportRect.bottom,
              viewportClientHeight: viewport.clientHeight,
              scrollTop: viewport.scrollTop,
              scrollHeight: viewport.scrollHeight,
            });
          }
        }
        previousTop = nextTop;
        visibleFrames += 1;
        status.dataset.maximumUpwardFrameMovement = String(
          maximumUpwardFrameMovement
        );
        status.dataset.minimumVisibleContentSeparation = String(
          minimumVisibleContentSeparation
        );
        status.dataset.visibleFrames = String(visibleFrames);
        status.dataset.worstFrame = worstFrame;
        if (performance.now() < deadline) {
          requestAnimationFrame(measureFrame);
        }
      };

      requestAnimationFrame(measureFrame);
    });

    if ((await thinkingToggle.getAttribute("aria-expanded")) !== "true") {
      await thinkingToggle.click();
    } else {
      await thinkingToggle.click();
      await thinkingToggle.click();
    }
    await expect(processView.getByTestId("thinking-detail").last()).toBeVisible();
    await page.waitForTimeout(1_600);

    const stability = await liveTurnStatus.evaluate((status) => ({
      maximumUpwardFrameMovement: Number(
        status.dataset.maximumUpwardFrameMovement ?? 0
      ),
      minimumVisibleContentSeparation: Number(
        status.dataset.minimumVisibleContentSeparation ?? 0
      ),
      visibleFrames: Number(status.dataset.visibleFrames ?? 0),
      worstFrame: status.dataset.worstFrame ?? "",
    }));

    expect(stability.visibleFrames).toBeGreaterThan(5);
    expect(stability.maximumUpwardFrameMovement).toBeLessThanOrEqual(8);
    expect(
      stability.minimumVisibleContentSeparation,
      stability.worstFrame
    ).toBeGreaterThanOrEqual(-1);

    const processDisclosure = processView.locator(".ai-disclosure").first();
    await expect(processDisclosure).toHaveAttribute(
      "data-disclosure-state",
      "open"
    );
    const transitionDuration = await processDisclosure.evaluate(
      (element) => getComputedStyle(element).transitionDuration
    );
    expect(transitionDuration).not.toBe("0s");

    await processToggle.click();
    await expect(processToggle).toHaveAttribute("aria-expanded", "false");
    await expect(processDisclosure).toHaveAttribute(
      "data-disclosure-state",
      "closed"
    );
    await page.waitForTimeout(260);
    const collapsedSeparation = await liveTurnStatus.evaluate((status) => {
      const viewport = document.querySelector<HTMLElement>(
        "[data-message-scroll-container='true']"
      );
      const precedingContent = status.previousElementSibling as HTMLElement | null;
      if (!viewport || !precedingContent) {
        return Number.POSITIVE_INFINITY;
      }
      return (
        status.getBoundingClientRect().top -
        Math.min(
          precedingContent.getBoundingClientRect().bottom,
          viewport.getBoundingClientRect().bottom
        )
      );
    });
    expect(collapsedSeparation).toBeGreaterThanOrEqual(-1);
    expect(collapsedSeparation).toBeLessThanOrEqual(36);
    await processToggle.click();
    await expect(processDisclosure).toHaveAttribute(
      "data-disclosure-state",
      "open"
    );
    await page.waitForTimeout(260);

    const streamingBody = page.locator(".ai-message-content").last();
    await expect(streamingBody).toBeVisible({ timeout: 120_000 });
    await streamingBody.evaluate((body) => {
      const deadline = performance.now() + 1_500;
      let previousTop = body.getBoundingClientRect().top;
      let maximumFrameMovement = 0;
      let worstFrame = "";
      let visibleFrames = 0;

      const measureFrame = () => {
        if (!body.isConnected) {
          return;
        }
        const nextTop = body.getBoundingClientRect().top;
        const movement = Math.abs(nextTop - previousTop);
        if (movement > maximumFrameMovement) {
          maximumFrameMovement = movement;
          const viewport = document.querySelector<HTMLElement>(
            "[data-message-scroll-container='true']"
          );
          worstFrame = JSON.stringify({
            movement,
            previousTop,
            nextTop,
            scrollTop: viewport?.scrollTop,
            scrollHeight: viewport?.scrollHeight,
          });
        }
        previousTop = nextTop;
        visibleFrames += 1;
        body.dataset.maximumFrameMovement = String(maximumFrameMovement);
        body.dataset.visibleFrames = String(visibleFrames);
        body.dataset.worstFrame = worstFrame;
        if (performance.now() < deadline) {
          requestAnimationFrame(measureFrame);
        }
      };

      requestAnimationFrame(measureFrame);
    });
    await page.waitForTimeout(1_600);

    const bodyStability = await streamingBody.evaluate((body) => ({
      maximumFrameMovement: Number(body.dataset.maximumFrameMovement ?? 0),
      visibleFrames: Number(body.dataset.visibleFrames ?? 0),
      worstFrame: body.dataset.worstFrame ?? "",
    }));
    expect(bodyStability.visibleFrames).toBeGreaterThan(5);
    expect(
      bodyStability.maximumFrameMovement,
      bodyStability.worstFrame
    ).toBeLessThanOrEqual(8);

    const scrollViewport = page.locator(
      "[data-message-scroll-container='true']"
    );
    const viewportBox = await scrollViewport.boundingBox();
    if (!viewportBox) {
      throw new Error("消息滚动区域不可见");
    }
    await page.mouse.move(
      viewportBox.x + viewportBox.width / 2,
      viewportBox.y + viewportBox.height / 2
    );
    await page.mouse.wheel(0, -12);
    await expect(page.getByTestId("scroll-to-bottom")).toBeVisible();
    await page.mouse.wheel(0, -320);
    await expect(liveTurnStatus).toHaveCount(1);
    await expect(page.getByTestId("live-turn-status-layer")).toHaveCount(0);
    await expect(page.getByTestId("live-turn-status-slot")).toHaveCount(0);
    await expect(page.getByTestId("live-turn-status-breathing-room")).toHaveCount(0);
    await expect
      .poll(() =>
        liveTurnStatus.evaluate((status) => {
          const viewport = status.closest<HTMLElement>(
            "[data-message-scroll-container='true']"
          );
          if (!viewport) return false;
          return (
            status.getBoundingClientRect().top >=
            viewport.getBoundingClientRect().bottom
          );
        })
      )
      .toBe(true);

    await page.getByTestId("scroll-to-bottom").click();
    await expect
      .poll(() =>
        liveTurnStatus.evaluate((status) => {
          const viewport = status.closest<HTMLElement>(
            "[data-message-scroll-container='true']"
          );
          if (!viewport) return false;
          const statusRect = status.getBoundingClientRect();
          const viewportRect = viewport.getBoundingClientRect();
          return statusRect.top < viewportRect.bottom && statusRect.bottom > viewportRect.top;
        })
      )
      .toBe(true);

    await expect(processToggle).toHaveAttribute("aria-expanded", "false", {
      timeout: 120_000,
    });
    await expect(liveTurnStatus).toHaveCount(0);
  }
);
