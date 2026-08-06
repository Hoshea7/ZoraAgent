import { expect, test } from "./support/electron-fixture";

test("reasoning effort selector shows default medium", async ({ page }) => {
  const reasoningSelector = page.getByRole("button", { name: "切换推理强度" });
  await expect(reasoningSelector).toBeVisible();
  await expect(reasoningSelector).toContainText("思考: 中");
});

test("switch reasoning effort to high and persist in session", async ({ page }) => {
  const reasoningSelector = page.getByRole("button", { name: "切换推理强度" });
  await reasoningSelector.click();

  await page.getByRole("button", { name: /高/ }).click();
  await expect(reasoningSelector).toContainText("思考: 高");

  // Send a message to create a session
  const composer = page.getByPlaceholder(/给 Zora 发消息/);
  await composer.fill("E2E_REASONING_TEST");
  await composer.press("Enter");

  // Wait for reply
  await expect(page.getByText("E2E_PI_REPLY: zora", { exact: true })).toBeVisible();

  // Verify the selector still shows "高" after session is created
  await expect(reasoningSelector).toContainText("思考: 高");
});

test("switch reasoning effort to none shows plain label", async ({ page }) => {
  const reasoningSelector = page.getByRole("button", { name: "切换推理强度" });
  await reasoningSelector.click();

  await page.getByRole("button", { name: /关闭/ }).click();
  await expect(reasoningSelector).toContainText("思考");
  await expect(reasoningSelector).not.toContainText("思考:");
});

test("draft mode reasoning effort persists after first message", async ({ page }) => {
  // Switch to "low" in draft mode (before sending any message)
  const reasoningSelector = page.getByRole("button", { name: "切换推理强度" });
  await reasoningSelector.click();
  await page.getByRole("button", { name: /低/ }).click();
  await expect(reasoningSelector).toContainText("思考: 低");

  // Send message
  const composer = page.getByPlaceholder(/给 Zora 发消息/);
  await composer.fill("帮我读一下 package.json，并告诉我 package name。");
  await composer.press("Enter");

  // Verify reply
  await expect(page.getByText("E2E_PI_REPLY: zora", { exact: true })).toBeVisible();

  // Verify selector still shows "低" in session mode
  await expect(reasoningSelector).toContainText("思考: 低");
});
