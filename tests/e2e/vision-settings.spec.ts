import { E2E_COVERAGE, expect, test } from "./support/electron-fixture";

test("用户可从已配置模型中启用视觉中转", E2E_COVERAGE.productLocal, async ({ page }) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型配置", exact: true }).click();
  await page.locator("summary").filter({ hasText: "图片能力识别" }).click();
  const capabilitySelectors = page.getByRole("combobox", { name: /图片能力/ });
  const configuredModelCount = await capabilitySelectors.count();
  expect(configuredModelCount).toBeGreaterThan(0);
  await capabilitySelectors.first().selectOption("unsupported");
  await expect(capabilitySelectors.first()).toHaveValue("unsupported");

  await page.getByRole("button", { name: "视觉助手", exact: true }).click();

  const toggle = page.getByRole("switch", { name: "启用视觉中转" });
  const modelSelector = page.getByRole("button", { name: "选择视觉模型" });

  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(modelSelector).not.toContainText("暂无可用模型");
  await expect(page.getByText("模型能力覆盖")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await modelSelector.click();
  await expect(page.getByRole("menuitem")).toHaveCount(configuredModelCount);
});
