import {
  E2E_COVERAGE,
  PROBE_SKILL_TOKEN,
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

/**
 * 切片 6：Skills 在两个 Runtime 下对齐。
 *
 * 验证视角是「一个装了 Skill、又在两个引擎间切换的用户」：我装的 Skill 在任何
 * 引擎下都该生效（Pi 曾用 noExtensions 把扩展整体关掉，属于静默降级）。
 *
 * 这里曾经还有一条断言 Runtime 选择器把"不支持的产品能力"写在界面上的用例。
 * 它随那张手写产品能力表一起删除了：能力表没有可信来源（planMode 实测就是
 * 错的），把它的 UI 文案钉进 E2E 只是给失真信息又加一道锁。
 */

for (const runtime of RUNTIMES) {
  test.describe(`[${runtime}] Skills`, E2E_COVERAGE.agentProvider, () => {
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
