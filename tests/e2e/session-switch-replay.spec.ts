import {
  PACKAGE_JSON_PATH,
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

const NOW = "2026-08-19T07:00:00.000Z";
const PROJECT_ID = "session-switch-replay-project";
const SESSION_ID = "session-switch-replay-session";
const SESSION_TITLE = "切换重放回归会话";

/**
 * 回归：会话运行中 renderer 重载（刷新窗口/应用重启后重连），主进程会对
 * renderer 重放本次 run 的事件流。修复前（无锚点截断）已落盘的 assistant
 * 快照被当作新事件灌进新建的 streaming turn，出现内容完全重复的第二个
 * Zora 块。修复后 replay 以最后落盘的 assistant 快照为锚点截断，并把恢复
 * 的最后一个 assistant turn 重新置为 streaming 承接后续事件，重连后只有
 * 一个助手块。
 */
for (const runtime of RUNTIMES) {
  test.describe(`[${runtime}] 运行中重连会话不产生重复块`, () => {
    test.use({
      workspaceSeed: {
        id: PROJECT_ID,
        name: "切换重放检查",
        createdAt: NOW,
        updatedAt: NOW,
        sessions: [
          {
            id: SESSION_ID,
            title: SESSION_TITLE,
            createdAt: NOW,
            updatedAt: NOW,
            permissionMode: "yolo",
          },
        ],
        sessionMessages: {
          [SESSION_ID]: [
            {
              id: "seed-user-message",
              role: "user" as const,
              text: "历史消息，用于让会话出现在侧栏。",
              timestamp: Date.parse(NOW),
            },
          ],
        },
      },
    });

    test("run 进行中重载页面重连，助手块与正文都不重复", async ({ page }) => {
      test.setTimeout(300_000);

      await page
        .getByRole("button", { name: "切换重放检查", exact: true })
        .click();
      await page.locator(`[data-session-id="${SESSION_ID}"]`).click();
      await expect(
        page.getByRole("heading", { name: SESSION_TITLE })
      ).toBeVisible();

      await selectRuntime(page, runtime);

      const uniqueToken = "SESSION_REPLAY_TOKEN_5309";
      await sendMessage(
        page,
        `请使用 Read 工具读取 ${PACKAGE_JSON_PATH}，然后在回复末尾单独一行输出这个标识：${uniqueToken}`
      );

      // Read 出现在过程视图意味着第一个 assistant 快照已广播并落盘，
      // 此时重载页面正好命中重放窗口。
      const processView = page.locator(".ai-process-content").last();
      await expect(processView).toContainText("Read", { timeout: 120_000 });

      // 重载 renderer（模拟刷新窗口/应用重启后重连）：projection 状态清空，
      // 重连时触发 agent:sync-active-timeline 重放本次 run 的事件流。
      await page.reload();
      await page
        .getByRole("button", { name: "切换重放检查", exact: true })
        .click();
      await page.locator(`[data-session-id="${SESSION_ID}"]`).click();
      await expect(
        page.getByRole("heading", { name: SESSION_TITLE })
      ).toBeVisible();

      // 修复前：重放的快照会新建第二个 streaming turn，出现两个
      // 「正在思考」状态提示。
      const liveStatusCount = await page
        .locator('[data-testid="live-turn-status"]')
        .count();
      expect(liveStatusCount).toBeLessThanOrEqual(1);

      // 等回复结束，唯一 token 只允许出现一次；重复渲染会让它出现两份。
      const bodies = page.locator(".ai-message-content");
      await expect(bodies.filter({ hasText: uniqueToken })).toHaveCount(
        1,
        { timeout: 180_000 }
      );

      // run 结束后没有残留的 streaming 状态块。
      await expect(
        page.locator('[data-testid="live-turn-status"]')
      ).toHaveCount(0, { timeout: 60_000 });

      // 恢复出的助手块在整个会话中只有一个：一次 run 一个块（user 消息也是
      // article，所以用语义化标记只数助手块）。
      const assistantBlocks = page.locator("[data-assistant-message]");
      await expect(assistantBlocks).toHaveCount(1);
    });
  });
}
