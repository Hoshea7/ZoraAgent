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
 *   2. 开着思考时，真实调用应该正常完成，并保持用户选择的档位
 *   3. 关掉思考时，就不该再给我看思考过程
 *   4. 换引擎不改变以上任何一条
 *
 * Runtime 参数翻译由 L2 覆盖。真实 Provider 是否返回可见 thinking 由模型决定，
 * E2E 不把模型输出形态作为档位生效的唯一判据。
 *
 * UI 中的推理强度选项为：关闭 / 高 / 最大。
 */

const reasoningSelector = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "切换模型与推理强度" });

const REASONING_LEVEL_BY_LABEL = {
  关闭: "off",
  高: "high",
  最大: "max",
} as const;

/** 走真实用户路径切换推理档位。已处于目标档位时不重复操作。 */
async function selectReasoning(
  page: import("@playwright/test").Page,
  label: "关闭" | "高" | "最大"
): Promise<void> {
  const selector = reasoningSelector(page);
  await expect(selector).toBeVisible();

  const alreadySelected =
    (await selector.getAttribute("data-reasoning-level")) ===
    REASONING_LEVEL_BY_LABEL[label];
  if (alreadySelected) return;

  await selector.click();
  const slider = page.getByRole("slider", { name: "推理强度" });
  await slider.focus();
  await slider.press("Home");
  const steps = label === "关闭" ? 0 : label === "高" ? 1 : 2;
  for (let index = 0; index < steps; index += 1) {
    await slider.press("ArrowRight");
  }
  await page.keyboard.press("Escape");
  await expect(selector).toHaveAttribute(
    "data-reasoning-level",
    REASONING_LEVEL_BY_LABEL[label]
  );
}

test("默认推理强度为高", async ({ page }) => {
  const selector = reasoningSelector(page);
  await expect(selector).toBeVisible();
  await expect(selector).toContainText("高");
});

test("切到关闭后入口只显示模型", async ({ page }) => {
  await selectReasoning(page, "关闭");

  const selector = reasoningSelector(page);
  await expect(selector).not.toContainText("关闭");
  await expect(selector).toHaveAttribute("data-reasoning-level", "off");
});

test("草稿态选择的推理强度在首条消息后仍然保留", async ({ page }) => {
  test.setTimeout(240_000);

  await selectReasoning(page, "最大");
  await expect(reasoningSelector(page)).toContainText("最大");

  // 首条消息会把草稿态落成真实会话，选择不应被重置。
  await sendMessage(page, "只回复这两个字：收到");
  await expect(page.locator(".ai-message-content").last()).toContainText(
    /收到/,
    { timeout: 180_000 }
  );

  await expect(reasoningSelector(page)).toContainText("最大");
});

for (const runtime of RUNTIMES) {
  test.describe(`[${runtime}] 推理强度生效`, () => {
    test("开启高推理后真实调用完成且档位保持", async ({ page }) => {
      test.setTimeout(240_000);

      await selectRuntime(page, runtime);
      await selectReasoning(page, "高");

      await sendMessage(
        page,
        "请先思考再回答：10 和 20 哪个更接近 12？只回复那个数字。"
      );

      await expect(page.locator(".ai-message-content").last()).toContainText(
        /10/,
        { timeout: 180_000 }
      );
      await expect(reasoningSelector(page)).toContainText("高");
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
