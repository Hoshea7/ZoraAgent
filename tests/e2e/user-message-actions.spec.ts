import { E2E_COVERAGE, expect, test } from "./support/electron-fixture";

const WORKSPACE_ID = "user-message-actions-workspace";
const SESSION_ID = "user-message-actions-session";
const NOW = "2026-08-14T14:06:00.000Z";
const MESSAGE_TEXT = "这是一条需要复制的用户消息";

test.use({
  workspaceSeed: {
    id: WORKSPACE_ID,
    name: "用户消息操作测试",
    createdAt: NOW,
    updatedAt: NOW,
    sessions: [
      {
        id: SESSION_ID,
        title: "消息操作",
        createdAt: NOW,
        updatedAt: NOW,
        permissionMode: "ask" as const,
      },
    ],
    sessionMessages: {
      [SESSION_ID]: [
        {
          id: "seed-user-message-actions",
          role: "user" as const,
          text: MESSAGE_TEXT,
          timestamp: Date.parse(NOW),
        },
      ],
    },
  },
});

test("用户消息下方显示时间、复制和编辑操作", E2E_COVERAGE.productLocal, async ({
  page,
}) => {
  await page.getByRole("button", { name: "用户消息操作测试", exact: true }).click();
  await page.getByRole("button", { name: /^消息操作/ }).click();

  const message = page.locator('[data-message-id="seed-user-message-actions"]');
  const actions = message.locator('[data-user-message-actions="true"]');

  await expect(message.getByText(MESSAGE_TEXT, { exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect
    .poll(() => actions.evaluate((element) => getComputedStyle(element).opacity))
    .toBe("0");
  await message.getByRole("article").hover();
  await expect
    .poll(() => actions.evaluate((element) => getComputedStyle(element).opacity))
    .toBe("1");
  await expect(actions.locator("time")).toHaveText("22:06");
  await expect(actions.getByRole("button", { name: "复制" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "修改消息" })).toBeVisible();

  await actions.getByRole("button", { name: "复制" }).click();
  await expect(actions.getByRole("button", { name: "已复制" })).toBeVisible();
});
