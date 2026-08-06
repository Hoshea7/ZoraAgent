import { expect, test } from "./support/electron-fixture";

test("新会话通过 Pi Runtime 读取文件并显示回复", async ({ page }) => {
  const runtimeSelector = page.getByRole("button", { name: "切换运行时" });

  await expect(runtimeSelector).toContainText("Pi");

  const composer = page.getByPlaceholder(/给 Zora 发消息/);
  await composer.fill("帮我读一下 package.json，并告诉我 package name。");
  await composer.press("Enter");

  await expect(page.getByText("E2E_PI_REPLY: zora", { exact: true })).toBeVisible();
  await expect(runtimeSelector).toContainText("Pi");
  await expect(runtimeSelector).toBeEnabled();

  const process = page.locator(".ai-process-content");
  await expect(process).toContainText("Read");
});

test("Pi 思考过程先于正文出现并保持稳定顺序", async ({ page }) => {
  const composer = page.getByPlaceholder(/给 Zora 发消息/);
  await composer.fill("E2E_THINKING_ORDER");
  await composer.press("Enter");

  const process = page.locator(".ai-process-content").last();
  const reply = page.getByText("E2E_THINKING_REPLY", { exact: true });
  await expect(process).toContainText("正在思考");
  await expect(reply).not.toBeVisible();

  await expect(reply).toBeVisible();
  await expect(process).toContainText("已完成分析");
});

test("Pi 思考、工具调用和最终回复按统一事件链渲染", async ({ page }) => {
  const composer = page.getByPlaceholder(/给 Zora 发消息/);
  await composer.fill("E2E_THINKING_TOOL");
  await composer.press("Enter");

  const process = page.locator(".ai-process-content").last();
  await expect(process).toContainText("正在思考");
  await expect(page.getByText("E2E_THINKING_TOOL_REPLY", { exact: true })).toBeVisible();
  await expect(process).toContainText("已完成分析 · 1 次工具调用");

  await process.getByRole("button").first().click();
  await expect(process.getByRole("button", { name: /^Read/ })).toHaveCount(1);
});

test.describe("同一会话 Runtime 切换", () => {
  test.use({ mockDefaultProtocol: "anthropic" });

  test("同一会话可逐轮切换 Runtime 并保留 Pi 上下文", async ({ page }) => {

    const composer = page.getByPlaceholder(/给 Zora 发消息/);
    await composer.fill("请记住 E2E_CONTEXT_ALPHA");
    await composer.press("Enter");
    await expect(page.getByText("E2E_CONTEXT_SAVED", { exact: true })).toBeVisible();

    const runtimeSelector = page.getByRole("button", { name: "切换运行时" });
    await runtimeSelector.click();
    await page.getByRole("button", { name: /Claude/ }).click();
    await expect(runtimeSelector).toContainText("Claude");

    await composer.fill("E2E_CLAUDE_TURN");
    await composer.press("Enter");
    await expect(page.getByText("E2E_CLAUDE_REPLY", { exact: true })).toBeVisible();

    await runtimeSelector.click();
    await page.getByRole("button", { name: /Pi/ }).click();
    await expect(runtimeSelector).toContainText("Pi");

    await composer.fill("E2E_CONTEXT_CHECK");
    await composer.press("Enter");
    await expect(page.getByText("E2E_CONTEXT_PASS", { exact: true })).toBeVisible();
  });
});

test("模型配置展示 Provider 图标和支持的 Runtime", async ({ page }) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();

  await expect(page.getByRole("heading", { name: "模型配置" })).toBeVisible();
  await expect(page.getByText("E2E OpenAI", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "E2E OpenAI 图标" }).last()).toBeVisible();

  const openAiRow = page
    .getByText("E2E OpenAI", { exact: true })
    .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]");
  const runtimeChips = openAiRow.getByLabel("支持的 Runtime");
  await expect(runtimeChips).toContainText("Pi");
  await expect(runtimeChips).not.toContainText("Claude");
});

test("Pi 运行中追加消息并在当前运行结束后继续处理", async ({ page }) => {
  const composer = page.getByPlaceholder(/给 Zora 发消息/);
  await composer.fill("E2E_QUEUE_START");
  await composer.press("Enter");

  await expect(page.locator('button[title="停止"]')).toBeVisible();
  await composer.fill("E2E_QUEUE_NEXT");
  await composer.press("Enter");

  await expect(page.getByText("E2E_QUEUE_REPLY", { exact: true })).toBeVisible();
});

test("Pi 写文件时复用 Zora 权限确认流程", async ({ page }) => {
  const composer = page.getByPlaceholder(/给 Zora 发消息/);
  await composer.fill("E2E_PERMISSION_WRITE");
  await composer.press("Enter");

  await expect(page.getByRole("heading", { name: "需要 Write 执行权限" })).toBeVisible();
  await page.getByRole("button", { name: "允许", exact: true }).click();
  await expect(page.getByText("E2E_PERMISSION_ALLOWED", { exact: true })).toBeVisible();
});

test("Pi 长响应可以停止，停止后会话仍可继续发送", async ({ page }) => {
  const composer = page.getByPlaceholder(/给 Zora 发消息/);
  await composer.fill("E2E_SLOW_STOP");
  await composer.press("Enter");

  const stopButton = page.locator('button[title="停止"]');
  await expect(stopButton).toBeVisible();
  await stopButton.click();
  await expect(stopButton).not.toBeVisible();
  await expect(page.getByText("E2E_SLOW_FINISHED", { exact: true })).not.toBeVisible();

  await composer.fill("帮我读一下 package.json，并告诉我 package name。");
  await composer.press("Enter");
  await expect(page.getByText("E2E_PI_REPLY: zora", { exact: true })).toBeVisible();
});
