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
  test.use({ providerModels: [] });

  test("用户手动添加并启用模型后可通过该模型完成真实 Agent 任务", async ({ page }) => {
  test.setTimeout(240_000);

  const providers = await loadRealProviders();
  const provider = providers[0];
  const model = provider?.models.find((item) => item.enabled);
  expect(provider).toBeTruthy();
  expect(model).toBeTruthy();

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型配置", exact: true }).click();
  await page.getByRole("button", { name: `编辑 ${provider!.name}` }).click();

  const dialog = page.getByRole("dialog", { name: "编辑模型配置" });
  await expect(dialog.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByText("暂无已启用模型")).toBeVisible();
  await dialog.getByPlaceholder("模型 ID").fill(model!.id);
  await dialog.getByPlaceholder("显示名称（可选）").fill("E2E 手动模型");
  await dialog.getByRole("button", { name: "手动添加" }).click();
  await expect(dialog.getByText("E2E 手动模型")).toBeVisible();
  await expect(dialog.getByText(model!.id)).toBeVisible();

  await dialog.getByPlaceholder("模型 ID").fill("zora-e2e-disabled-model");
  await dialog.getByRole("button", { name: "手动添加" }).click();
  await expect(dialog.getByText("zora-e2e-disabled-model", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "取消启用", exact: true }).last().click();
  await expect(dialog.getByText("zora-e2e-disabled-model", { exact: true })).toBeVisible();
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

test("用户从 Provider 获取模型后可启用模型并完成真实 Agent 任务", async ({ page }) => {
  test.setTimeout(300_000);

  const providers = await loadRealProviders();
  const provider = providers.find((item) =>
    item.baseUrl.toLowerCase().includes("openrouter.ai")
  );
  const model = provider?.models.find((item) => item.enabled);
  const modelCounts = new Map<string, number>();
  for (const item of providers) {
    for (const candidate of item.models.filter((entry) => entry.enabled)) {
      modelCounts.set(candidate.id, (modelCounts.get(candidate.id) ?? 0) + 1);
    }
  }
  const agentProvider = providers.find(
    (item) =>
      item.id !== provider?.id &&
      !item.baseUrl.toLowerCase().includes("openrouter.ai") &&
      item.models.some(
        (candidate) => candidate.enabled && modelCounts.get(candidate.id) === 1
      )
  );
  const agentModel = agentProvider?.models.find(
    (candidate) => candidate.enabled && modelCounts.get(candidate.id) === 1
  );
  expect(provider, "本机需要一个已启用的 OpenRouter Provider 用于真实模型发现 E2E").toBeTruthy();
  expect(model).toBeTruthy();
  expect(agentProvider, "本机需要另一个模型 ID 唯一的已启用 Provider 用于真实 Agent E2E").toBeTruthy();
  expect(agentModel).toBeTruthy();

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型配置", exact: true }).click();
  await page.getByRole("button", { name: `编辑 ${provider!.name}` }).click();

  const dialog = page.getByRole("dialog", { name: "编辑模型配置" });
  await expect(dialog.getByText(model!.id, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "取消启用", exact: true }).click();

  await dialog.getByRole("button", { name: "从 Provider 获取" }).click();
  await expect(dialog.getByText("模型列表已更新，新模型默认未启用。", { exact: true })).toBeVisible({
    timeout: 120_000,
  });

  const filter = dialog.getByPlaceholder("筛选可用模型");
  if (await filter.isVisible()) {
    await filter.fill(model!.id);
  }
  await expect(dialog.getByText(model!.id, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "启用", exact: true }).click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTitle("关闭设置 (Esc)").click();

  await selectRuntime(page, "pi");
  await selectModel(page, agentModel!.id);
  await sendMessage(
    page,
    `请使用 Read 工具读取 ${PACKAGE_JSON_PATH}，然后只回答 name 字段值。`,
  );
  await expect(page.locator(".ai-message-content").last()).toContainText(/zora/i, {
    timeout: 120_000,
  });
  await expectReadTrace(page);
});
