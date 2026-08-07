import {
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

/**
 * 切片 2：AskUserQuestion 单实现。
 *
 * 验证视角是「一个被 Agent 征询意见的用户会怎么确认这条通道真的通」：
 *   1. Agent 能真的把问题递到我面前（模型调不出工具本身就是缺陷）
 *   2. 递问题不该顺带向我要一次权限（提问不是危险操作，别问两次）
 *   3. 我的选择要真的被采纳，而不是 Agent 自己编一个答案继续
 *   4. 换引擎不改变以上任何一条
 *
 * 断言锚点是「我选的那个词是否出现在 Agent 后续回复里」：这能区分
 * "Agent 收到了我的答案" 与 "Agent 只是把卡片关掉然后自说自话"。
 */

/** 选项标签用低频 token，避免模型在未收到答案时凭常识猜中。 */
const PICKED = "ZEBRA_QUARTZ";
const OTHER = "MAROON_TUNDRA";

const askCard = (page: import("@playwright/test").Page) =>
  page.getByText("Zora 需要你的回答", { exact: true });

const approvalCard = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", { name: /需要 \w+ 执行权限/ });

for (const runtime of RUNTIMES) {
  test.describe(`[${runtime}] 向用户提问`, () => {
    test("Agent 提问后用户选择的答案被真正采纳", async ({ page }) => {
      test.setTimeout(240_000);

      await selectRuntime(page, runtime);

      // 明确要求调用工具：如果模型调不出来，这条用例就该失败——
      // 那意味着工具没注册、schema 不可用或 system prompt 没描述它。
      await sendMessage(
        page,
        [
          "请调用 AskUserQuestion 工具向我提问，只问一个问题：「请选择一个代号」。",
          `提供两个选项，label 分别是 ${PICKED} 和 ${OTHER}。`,
          "拿到我的回答后，请只回复我选中的那个代号本身，不要加任何其他内容。",
        ].join("")
      );

      // 问题必须真的递到用户面前。
      await expect(askCard(page)).toBeVisible({ timeout: 180_000 });

      // 提问不是危险操作：不应该在问答之外再要一次授权。
      await expect(approvalCard(page)).toHaveCount(0);

      const submit = page.getByRole("button", { name: "提交", exact: true });
      await expect(submit).toBeDisabled();

      await page.getByRole("button", { name: new RegExp(PICKED) }).click();
      await expect(submit).toBeEnabled();
      await submit.click();

      // 卡片收起，且 Agent 用我选的答案继续。
      await expect(askCard(page)).toHaveCount(0, { timeout: 60_000 });
      await expect(page.locator(".ai-message-content").last()).toContainText(
        PICKED,
        { timeout: 180_000 }
      );
    });

    test("用户自由输入的回答同样被采纳", async ({ page }) => {
      test.setTimeout(240_000);

      await selectRuntime(page, runtime);

      await sendMessage(
        page,
        [
          "请调用 AskUserQuestion 工具向我提问，只问一个问题：「请给出一个代号」，不要提供预设选项。",
          "拿到我的回答后，请只重复我给出的代号本身，不要加任何其他内容。",
        ].join("")
      );

      await expect(askCard(page)).toBeVisible({ timeout: 180_000 });

      // 真实模型不一定听话：即使要求不给预设选项，它仍可能给。而卡片在有选项时
      // 只先渲染「输入你的想法...」入口按钮，点开后才出现输入框。两种形态都要能用。
      const customEntry = page.getByRole("button", {
        name: "输入你的想法...",
        exact: true,
      });
      if ((await customEntry.count()) > 0) {
        await customEntry.first().click();
      }

      await page.getByPlaceholder("输入你的想法...").last().fill(PICKED);

      const submit = page.getByRole("button", { name: "提交", exact: true });
      await expect(submit).toBeEnabled();
      await submit.click();

      await expect(askCard(page)).toHaveCount(0, { timeout: 60_000 });
      await expect(page.locator(".ai-message-content").last()).toContainText(
        PICKED,
        { timeout: 180_000 }
      );
    });
  });
}
