import {
  PROBE_SKILL_TOKEN,
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

/**
 * 切片 6：Skills 对齐 + RuntimeCapabilities 显式声明。
 *
 * 验证视角是「一个装了 Skill、又在两个引擎间切换的用户会怎么确认自己没被静默降级」：
 *   1. 我装的 Skill 在任何引擎下都该生效（Pi 曾用 noExtensions 自己关掉）
 *   2. 引擎确实不支持某能力时，要在界面上明确告诉我，而不是让我以为它能用
 *
 * 第 2 条是这个切片存在的理由：能力缺失本身可以接受，"静默缺失"不可以。
 */

for (const runtime of RUNTIMES) {
  test.describe(`[${runtime}] Skills`, () => {
    test("已安装的 Skill 在该 Runtime 下生效", async ({ page }) => {
      test.setTimeout(240_000);

      await selectRuntime(page, runtime);

      // 口令只写在 SKILL.md 里，模型无法从常识推出；答对即证明 Skill 真被注入。
      await sendMessage(
        page,
        "请告诉我这个项目的 project mantra，只回复口令本身。"
      );

      await expect(page.locator(".ai-message-content").last()).toContainText(
        PROBE_SKILL_TOKEN,
        { timeout: 180_000 }
      );
    });
  });
}

test("Runtime 选择器显式声明各引擎的能力差异", async ({ page }) => {
  const selector = page.getByRole("button", { name: "切换运行时" });
  await expect(selector).toBeVisible();
  await selector.click();

  // 不支持的产品能力必须写在界面上，用户据此判断是否要换引擎。
  const capabilityNote = page.getByLabel("Runtime 能力差异").first();
  await expect(capabilityNote).toBeVisible();
  await expect(capabilityNote).toContainText("外部 MCP");
});
