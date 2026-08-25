import {
  E2E_COVERAGE,
  RUNTIMES,
  expect,
  expectAssistantTextUntilSettled,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

/**
 * 切片 5：ToolProvisioning —— 同一份工具清单在两个 Runtime 上等价可用。
 *
 * 用本机已配置的内置 MCP（zora_schedule）验证，不自造 server：它纯本地、结果确定，
 * 而且创建出的任务能在定时页面上看到，是比模型措辞可靠得多的断言锚点。
 *
 * 验证视角是「一个让 Agent 帮自己排定时任务的用户会怎么确认这事真办成了」：
 *   1. 我用自然语言说清时间和名字，Agent 就该把任务建出来
 *   2. 建出来的任务要真的出现在定时页面里（不是模型说"已创建"就算）
 *   3. 时间和名称要和我说的一致——这要求模型知道该传哪些参数
 *   4. 换引擎不改变以上任何一条
 *
 * 第 3 条是这个切片的核心：工具 schema 若对模型不可见（Pi 侧曾是空 schema），
 * 模型就只能瞎猜参数，任务要么建不出来，要么时间字段是错的。
 */

const TASK_TITLE = "ZORA_E2E_DAILY_REPORT";
const TASK_TIME = "09:15";
const TASK_CREATED_MARKER = "SCHEDULE_CREATED_OK";

async function selectYoloMode(
  page: import("@playwright/test").Page,
): Promise<void> {
  const modeButton = page.getByRole("button", { name: /^当前权限模式：/ });
  while (!(await modeButton.getAttribute("aria-label"))?.includes("YOLO")) {
    await modeButton.click();
  }
}

for (const runtime of RUNTIMES) {
  test.describe(`[${runtime}] 内置 MCP 工具`, E2E_COVERAGE.productAgentProvider, () => {
    test("Agent 能按用户给的时间和名称创建定时任务并出现在定时页面", async ({
      page,
    }) => {
      test.setTimeout(300_000);

      await selectRuntime(page, runtime);
      await selectYoloMode(page);
      const previousAssistantCount = await page
        .locator("[data-assistant-message='true']")
        .count();
      await sendMessage(
        page,
        [
          `请帮我创建一个定时任务：每天 ${TASK_TIME} 执行，`,
          `名称是 ${TASK_TITLE}，`,
          `任务内容是「汇总今天的工作日报」。创建完成后只回复 ${TASK_CREATED_MARKER}。`,
        ].join("")
      );

      await expectAssistantTextUntilSettled(
        page,
        TASK_CREATED_MARKER,
        previousAssistantCount,
        150_000,
      );

      // 产品状态是唯一可信锚点：模型可能声称已创建却没真的调用工具。
      await page.getByRole("button", { name: "定时", exact: true }).click();

      // 用「可访问名以任务名开头」锚定定时条目。会话列表项的名字以用户输入开头，
      // 因此不会被误命中；直接 getByText 会同时命中标题栏、用户消息和思考文本。
      const scheduleEntry = page.getByRole("button", {
        name: new RegExp(`^${TASK_TITLE}`),
      });
      await expect(scheduleEntry).toBeVisible({ timeout: 15_000 });

      // 时间字段正确，才说明模型真的看到了 schedule 参数结构而不是瞎猜。
      await expect(scheduleEntry).toContainText(TASK_TIME);
    });

    test("Agent 能列出已有定时任务", async ({ page }) => {
      test.setTimeout(300_000);

      await selectRuntime(page, runtime);
      await selectYoloMode(page);

      // 先建一个，再让 Agent 自己查回来：覆盖 create 与 list 两个 action。
      const createAssistantCount = await page
        .locator("[data-assistant-message='true']")
        .count();
      await sendMessage(
        page,
        [
          `请创建一个定时任务：每天 ${TASK_TIME} 执行，名称是 ${TASK_TITLE}，`,
          `内容是「汇总今天的工作日报」。创建完成后只回复 ${TASK_CREATED_MARKER}。`,
        ].join("")
      );
      await expectAssistantTextUntilSettled(
        page,
        TASK_CREATED_MARKER,
        createAssistantCount,
        150_000,
      );

      const listAssistantCount = await page
        .locator("[data-assistant-message='true']")
        .count();
      await sendMessage(
        page,
        "请查询我当前所有的定时任务，并把任务名称原样列出来。"
      );

      await expectAssistantTextUntilSettled(
        page,
        TASK_TITLE,
        listAssistantCount,
        120_000,
      );
    });
  });
}
