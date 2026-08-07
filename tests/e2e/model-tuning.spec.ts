import {
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

/**
 * 切片 3：ModelTuning（模型推理意图）。
 *
 * ModelTuning 是产品层声明的意图（off | high | max），由各 Adapter 翻译成引擎参数
 * （Claude 的 thinking+effort / Pi 的 thinkingLevel）。
 *
 * 验证视角是「一个调节推理强度的用户会怎么确认这个开关不是摆设」：
 *   1. 我选的档位要显示正确、并在会话建立后仍然保留
 *   2. 开着思考时，我应该能看到 Agent 的思考过程
 *   3. 关掉思考时，就不该再给我看思考过程
 *   4. 换引擎不改变以上任何一条
 *
 * 第 2、3 条是关键：只断言 UI 标签只能证明"我点了"，证明不了"引擎收到了"。
 * 过程视图里是否出现思考，才是这个意图真的被翻译并落到引擎的证据。
 *
 * UI 文案来自 ReasoningLevelSelector 的 REASONING_LABELS：关闭 / 高 / 最大。
 */

const reasoningSelector = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "切换推理强度" });

/** 走真实用户路径切换推理档位。已处于目标档位时不重复操作（当前项在菜单里是禁用态）。 */
async function selectReasoning(
  page: import("@playwright/test").Page,
  label: "关闭" | "高" | "最大"
): Promise<void> {
  const selector = reasoningSelector(page);
  await expect(selector).toBeVisible();

  const current = (await selector.textContent()) ?? "";
  const alreadySelected =
    label === "关闭" ? !current.includes("思考:") : current.includes(`思考: ${label}`);
  if (alreadySelected) return;

  await selector.click();
  await page.getByRole("button", { name: new RegExp(label) }).click();
}

test("默认推理强度为高", async ({ page }) => {
  const selector = reasoningSelector(page);
  await expect(selector).toBeVisible();
  await expect(selector).toContainText("思考: 高");
});

test("切到关闭后只显示「思考」而不带级别后缀", async ({ page }) => {
  await selectReasoning(page, "关闭");

  const selector = reasoningSelector(page);
  await expect(selector).toContainText("思考");
  await expect(selector).not.toContainText("思考:");
});

test("草稿态选择的推理强度在首条消息后仍然保留", async ({ page }) => {
  test.setTimeout(240_000);

  await selectReasoning(page, "最大");
  await expect(reasoningSelector(page)).toContainText("思考: 最大");

  // 首条消息会把草稿态落成真实会话，选择不应被重置。
  await sendMessage(page, "只回复这两个字：收到");
  await expect(page.locator(".ai-message-content").last()).toContainText(
    /收到/,
    { timeout: 180_000 }
  );

  await expect(reasoningSelector(page)).toContainText("思考: 最大");
});

for (const runtime of RUNTIMES) {
  test.describe(`[${runtime}] 推理强度生效`, () => {
    test("开启高推理时用户能看到思考过程", async ({ page }) => {
      test.setTimeout(240_000);

      await selectRuntime(page, runtime);
      await selectReasoning(page, "高");

      await sendMessage(
        page,
        "请先思考再回答：10 和 20 哪个更接近 12？只回复那个数字。"
      );

      // 思考被翻译到引擎并回吐，用户才能在过程视图看到它。
      await expect(page.locator(".ai-process-content").last()).toContainText(
        /思考/,
        { timeout: 180_000 }
      );
      await expect(page.locator(".ai-message-content").last()).toContainText(
        /10/,
        { timeout: 180_000 }
      );
    });

    test("关闭推理后不再展示思考过程", async ({ page }) => {
      test.setTimeout(240_000);

      await selectRuntime(page, runtime);
      await selectReasoning(page, "关闭");

      await sendMessage(page, "只回复这两个字：收到");
      await expect(page.locator(".ai-message-content").last()).toContainText(
        /收到/,
        { timeout: 180_000 }
      );

      // 关掉思考就该真的不产生思考过程，而不是仍在后台思考只是不显示。
      await expect(page.getByText("正在思考", { exact: false })).toHaveCount(0);
    });
  });
}
