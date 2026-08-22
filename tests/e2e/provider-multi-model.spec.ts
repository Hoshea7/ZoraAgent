import {
  PACKAGE_JSON_PATH,
  expect,
  loadRealProviders,
  selectModel,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";
import type { Page } from "@playwright/test";

async function expectReadTrace(page: Page): Promise<void> {
  const processView = page.locator(".ai-process-content");
  const toggle = processView.getByRole("button").first();
  await expect(toggle).toContainText(/工具调用/, { timeout: 120_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(processView.getByTestId("agent-activity")).toContainText("Read", {
    timeout: 30_000,
  });
}

test.describe("手动模型", () => {
  test.use({
    providerPresetId: "volcengine-coding-plan",
    providerModels: { models: [] },
  });

  test("用户可以先保存连接信息再配置模型", async ({ page }) => {
    const provider = (await loadRealProviders("volcengine-coding-plan"))[0]!;

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    await page.getByRole("button", { name: `编辑 ${provider.name}` }).click();
    const dialog = page.getByRole("dialog", { name: "编辑模型配置" });
    await expect(dialog.getByText("暂无已启用模型")).toBeVisible();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(provider.name, { exact: true })).toBeVisible();
    await page.getByTitle("关闭设置 (Esc)").click();
    await expect(page.getByTitle("请先配置模型")).toBeDisabled();
  });

  test("用户手动添加并启用模型后可通过该模型完成真实 Agent 任务", async ({ page }) => {
    test.setTimeout(240_000);

  const providers = await loadRealProviders("volcengine-coding-plan");
  const provider = providers[0];
  const model = provider?.models.find((item) => item.enabled && item.id === "glm-5.2");
  expect(provider).toBeTruthy();
  expect(model).toBeTruthy();

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型配置", exact: true }).click();
  await page.getByRole("button", { name: `编辑 ${provider!.name}` }).click();

  const dialog = page.getByRole("dialog", { name: "编辑模型配置" });
  await expect(dialog.getByText("暂无已启用模型")).toBeVisible();
  await dialog.getByPlaceholder("模型 ID").fill(model!.id);
  await dialog.getByPlaceholder("显示名称（可选）").fill("E2E 手动模型");
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  await expect(dialog.getByText("E2E 手动模型")).toBeVisible();
  await expect(dialog.getByText(model!.id)).toBeVisible();

  await dialog.getByPlaceholder("模型 ID").fill(model!.id);
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  await expect(dialog.getByText("模型已存在。", { exact: true })).toBeVisible();

  await dialog.getByPlaceholder("模型 ID").fill("zora-e2e-disabled-model");
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  await expect(dialog.getByText("zora-e2e-disabled-model", { exact: true })).toBeVisible();
  await dialog.getByRole("switch", { name: "停用模型 zora-e2e-disabled-model" }).click();
  await expect(dialog.getByText("zora-e2e-disabled-model", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "删除模型 zora-e2e-disabled-model" }).click();
  await expect(dialog.getByText("zora-e2e-disabled-model", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const defaultModel = page.getByText("默认模型", { exact: true }).locator("..");
  await expect(defaultModel).toContainText(model!.id);
  await page.getByTitle("关闭设置 (Esc)").click();

  await selectRuntime(page, "pi");
  await sendMessage(
    page,
    `请使用 Read 工具读取 ${PACKAGE_JSON_PATH}，然后只回答 name 字段值。`,
  );
  await expect(page.locator(".ai-message-content").last()).toContainText(/zora/i, {
    timeout: 120_000,
  });
  await expectReadTrace(page);
  });
});

test.describe("Provider 获取模型", () => {
  test.use({
    providerPresetId: "volcengine-coding-plan",
    providerModels: { models: [] },
  });

  test("Provider 获取失败后保留手动配置入口", async ({ page }) => {
    const provider = (await loadRealProviders("volcengine-coding-plan"))[0]!;

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    await page.getByRole("button", { name: `编辑 ${provider.name}` }).click();
    const dialog = page.getByRole("dialog", { name: "编辑模型配置" });

    await dialog.getByRole("combobox").first().selectOption("custom");
    await dialog.getByPlaceholder("https://...").fill("http://127.0.0.1:1/v1");
    await dialog.getByRole("button", { name: "从 Provider 获取" }).click();
    await expect(
      dialog.getByText("获取失败，请手动添加模型。", { exact: true })
    ).toBeVisible();

    await dialog.getByPlaceholder("模型 ID").fill("manual-after-fetch-error");
    await dialog.getByRole("button", { name: "添加", exact: true }).click();
    await expect(
      dialog.getByText("manual-after-fetch-error", { exact: true })
    ).toBeVisible();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("用户从 Provider 获取模型后可启用模型并完成真实 Agent 任务", async ({ page }) => {
  test.setTimeout(300_000);

  const providers = await loadRealProviders("volcengine-coding-plan");
  const provider = providers[0];
  const model = provider?.models.find(
    (item) => item.enabled && item.id === "glm-5.2"
  );
  expect(provider?.presetId).toBe("volcengine-coding-plan");
  expect(model).toBeTruthy();

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型配置", exact: true }).click();
  await page.getByRole("button", { name: `编辑 ${provider!.name}` }).click();

  const dialog = page.getByRole("dialog", { name: "编辑模型配置" });
  await expect(dialog.getByText("暂无已启用模型")).toBeVisible();

  await dialog.getByRole("button", { name: "从 Provider 获取" }).click();
  await expect(dialog.getByText(model!.id, { exact: true })).toBeVisible({
    timeout: 120_000,
  });

  const filter = dialog.getByPlaceholder("筛选可用模型");
  if (await filter.isVisible()) {
    await filter.fill(model!.id);
  }
  await expect(dialog.getByText(model!.id, { exact: true })).toBeVisible();
  await dialog.getByRole("switch", { name: /启用模型/ }).first().click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTitle("关闭设置 (Esc)").click();

  await selectRuntime(page, "pi");
  await selectModel(page, model!.id);
  await sendMessage(
    page,
    `请使用 Read 工具读取 ${PACKAGE_JSON_PATH}，然后只回答 name 字段值。`,
  );
  await expect(page.locator(".ai-message-content").last()).toContainText(/zora/i, {
    timeout: 120_000,
  });
  await expectReadTrace(page);
  });
});

test.describe("多模型连接测试", () => {
  test.use({
    providerPresetId: "volcengine-coding-plan",
    providerModels: { models: [
      { id: "glm-5.3", enabled: true },
      { id: "glm-5.2", enabled: true },
      { id: "minimax-m3", enabled: true },
    ] },
  });

  test("用户测试全部已启用模型并查看逐项结果", async ({ page }) => {
    test.setTimeout(180_000);
    const provider = (await loadRealProviders("volcengine-coding-plan"))[0]!;

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    await page.getByRole("button", { name: `编辑 ${provider.name}` }).click();
    const dialog = page.getByRole("dialog", { name: "编辑模型配置" });

    await dialog.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(dialog.getByRole("status", { name: /测试中/ })).toHaveCount(3);
    await expect(
      dialog.getByRole("status", { name: /连接成功|连接失败/ }),
    ).toHaveCount(3, {
      timeout: 120_000,
    });
    await expect(dialog.getByText(/^(?:3|\d\/3) 个模型连接成功$/)).toBeVisible();
  });

  test("用户可停止一组正在进行的模型测试", async ({ page }) => {
    const provider = (await loadRealProviders("volcengine-coding-plan"))[0]!;

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    await page.getByRole("button", { name: `编辑 ${provider.name}` }).click();
    const dialog = page.getByRole("dialog", { name: "编辑模型配置" });

    await dialog.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(dialog.getByRole("status", { name: /测试中/ })).toHaveCount(3);
    await dialog.getByRole("button", { name: "停止测试", exact: true }).click();
    await expect(dialog.getByRole("status", { name: /已停止/ })).toHaveCount(3);
  });
});

test.describe("Agent Plan OpenAI", () => {
  test.use({
    providerPresetId: "volcengine-agent-plan-anthropic",
    providerModels: { models: [{ id: "glm-5.2", enabled: true }] },
  });

  test("用户通过 Pi 使用 Agent Plan OpenAI 完成真实对话", async ({ page }) => {
    test.setTimeout(180_000);
    const provider = (await loadRealProviders("volcengine-agent-plan-anthropic"))[0]!;

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    await page.getByRole("button", { name: `编辑 ${provider.name}` }).click();

    const dialog = page.getByRole("dialog", { name: "编辑模型配置" });
    await dialog
      .getByRole("combobox")
      .first()
      .selectOption("volcengine-agent-plan-openai");
    await expect(dialog.getByPlaceholder("https://...")).toHaveValue(
      "https://ark.cn-beijing.volces.com/api/plan/v3",
    );
    await dialog.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(dialog.getByRole("status", { name: /连接成功/ })).toBeVisible({
      timeout: 120_000,
    });
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByTitle("关闭设置 (Esc)").click();

    await selectRuntime(page, "pi");
    await sendMessage(page, "只回答 AGENT_PLAN_OK");
    await expect(page.locator(".ai-message-content").last()).toContainText(
      "AGENT_PLAN_OK",
      { timeout: 120_000 },
    );
  });
});

test("用户在 Provider 列表停用并重新启用配置", async ({ page }) => {
  const provider = (await loadRealProviders("volcengine-coding-plan"))[0]!;

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型配置", exact: true }).click();
  const providerRow = page
    .getByRole("button", { name: `编辑 ${provider.name}` })
    .locator("../..");

  const disableSwitch = providerRow.getByRole("switch", {
    name: `停用 Provider ${provider.name}`,
  });
  await expect(disableSwitch).toHaveAttribute("aria-checked", "true");
  await disableSwitch.click();

  const enableSwitch = providerRow.getByRole("switch", {
    name: `启用 Provider ${provider.name}`,
  });
  await expect(enableSwitch).toHaveAttribute("aria-checked", "false");
  await enableSwitch.click();
  await expect(
    providerRow.getByRole("switch", { name: `停用 Provider ${provider.name}` })
  ).toHaveAttribute("aria-checked", "true");
});
