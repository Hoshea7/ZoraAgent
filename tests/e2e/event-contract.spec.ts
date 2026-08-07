import path from "node:path";
import {
  PACKAGE_JSON_PATH,
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

/**
 * 切片 4：事件契约。
 *
 * 事件契约收紧本身是内部改动，但它的用户可见面很具体：Agent 运行过程中每一类事件
 * 都要能被渲染层正确识别并显示。契约有逃生口时，畸形事件会静默丢失——用户看到的是
 * 空白过程、缺失的错误、或错序的思考与正文。
 *
 * 验证视角是「一个盯着 Agent 干活的用户会怎么确认自己看到的过程是完整可信的」：
 *   1. 工具失败了要告诉我，不能装作没发生
 *   2. 连续做了几件事，每件都要在过程里留痕
 *   3. 先给我看思考，再给我看结论
 *   4. 换引擎不改变以上任何一条
 */

const processView = (page: import("@playwright/test").Page) =>
  page.locator(".ai-process-content").last();

const body = (page: import("@playwright/test").Page) =>
  page.locator(".ai-message-content").last();

for (const runtime of RUNTIMES) {
  test.describe(`[${runtime}] 事件渲染`, () => {
    test("工具执行失败时用户能看到失败，而不是空白过程", async ({
      page,
      scratchDir,
    }) => {
      test.setTimeout(240_000);

      // 指向一个确定不存在的路径，让工具真的失败。
      const missing = path.join(scratchDir, "definitely-missing-file.txt");

      await selectRuntime(page, runtime);
      await sendMessage(
        page,
        `请使用 Read 工具读取 ${missing}。如果读取失败，请直接告诉我失败了。`
      );

      // 失败的工具调用仍必须在过程视图留痕：用户要知道 Agent 尝试过什么。
      await expect(processView(page)).toContainText("Read", {
        timeout: 180_000 ,
      });

      // 并且模型要能基于错误结果作答，而不是空转或静默结束。
      await expect(body(page)).toContainText(/失败|不存在|没有找到|无法/, {
        timeout: 180_000,
      });
    });

    test("连续多个工具调用在过程视图中都留痕", async ({ page, scratchDir }) => {
      test.setTimeout(240_000);

      const target = path.join(scratchDir, "event-contract.txt");

      await selectRuntime(page, runtime);
      await sendMessage(
        page,
        [
          `请依次做两件事：先用 Read 工具读取 ${PACKAGE_JSON_PATH}，`,
          `再用 Write 工具把该文件里的 name 字段值写入 ${target}。`,
        ].join("")
      );

      // 第一次写操作会触发审批（Ask 模式），批准后继续。
      const approval = page.getByRole("heading", {
        name: /需要 \w+ 执行权限/,
      });
      await expect(approval.or(processView(page))).toBeVisible({
        timeout: 180_000,
      });
      if ((await approval.count()) > 0) {
        await page.getByRole("button", { name: "允许", exact: true }).click();
      }

      // 两个不同工具都应出现在过程视图，缺任何一个都说明事件在映射中丢了。
      await expect(processView(page)).toContainText("Read", {
        timeout: 180_000,
      });
      await expect(processView(page)).toContainText("Write", {
        timeout: 180_000,
      });
    });

    test("思考过程先于正文出现，顺序稳定", async ({ page }) => {
      test.setTimeout(240_000);

      await selectRuntime(page, runtime);
      await sendMessage(
        page,
        "请先思考再回答：一个正十二面体有多少条棱？只回复数字。"
      );

      // 用户必须先看到"正在想什么"，再看到结论；反序意味着事件时序被打乱。
      const firstVisible = await Promise.race([
        processView(page)
          .waitFor({ state: "visible", timeout: 180_000 })
          .then(() => "process" as const),
        body(page)
          .waitFor({ state: "visible", timeout: 180_000 })
          .then(() => "body" as const),
      ]);
      expect(firstVisible).toBe("process");

      await expect(body(page)).toContainText(/30|三十/, { timeout: 180_000 });
    });
  });
}
