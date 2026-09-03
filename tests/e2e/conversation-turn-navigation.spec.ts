import { E2E_COVERAGE, expect, test } from "./support/electron-fixture";

const WORKSPACE_ID = "conversation-turn-navigation-workspace";
const SESSION_ID = "conversation-turn-navigation-session";
const CREATED_AT = "2026-09-03T02:00:00.000Z";
const turns = Array.from({ length: 6 }, (_, index) => {
  const turnNumber = index + 1;
  const timestamp = Date.parse(CREATED_AT) + index * 60_000;
  return [
    {
      id: `navigation-user-${turnNumber}`,
      role: "user" as const,
      text: `第 ${turnNumber} 轮问题：请检查第 ${turnNumber} 组内容`,
      timestamp,
    },
    {
      id: `navigation-assistant-${turnNumber}`,
      role: "assistant" as const,
      text: `第 ${turnNumber} 轮回复。${"用于构造长会话的确定性内容。".repeat(100)}`,
      timestamp: timestamp + 1,
    },
  ];
}).flat();

test.use({
  workspaceSeed: {
    id: WORKSPACE_ID,
    name: "轮次导航测试项目",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    sessions: [
      {
        id: SESSION_ID,
        title: "长会话轮次定位",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        permissionMode: "ask" as const,
      },
    ],
    sessionMessages: {
      [SESSION_ID]: turns,
    },
  },
});

test("用户预览并跳转到长会话中的指定轮次", E2E_COVERAGE.productLocal, async ({
  page,
}) => {
  await page.getByRole("button", { name: "轮次导航测试项目", exact: true }).click();
  await page.getByRole("button", { name: /^长会话轮次定位/ }).click();

  const navigation = page.getByRole("navigation", { name: "会话轮次" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("button")).toHaveCount(6);

  const markers = navigation.getByTestId("conversation-turn-marker");
  const restingWidths = await markers.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().width)
  );
  expect(new Set(restingWidths.map((width) => Math.round(width))).size).toBe(1);
  const restingColors = await markers.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).backgroundColor)
  );
  expect(restingColors[0]).not.toBe(restingColors.at(-1));

  const thirdTurn = navigation.getByRole("button", { name: /第 3 轮/ });
  await thirdTurn.hover();
  const preview = page.getByRole("tooltip");
  await expect(preview).toContainText("第 3 轮");
  await expect(preview).toContainText("请检查第 3 组内容");

  await expect.poll(async () => {
    const widths = await markers.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().width)
    );
    return widths[2] > widths[1] && widths[1] > widths[0];
  }).toBe(true);

  const firstTurn = navigation.getByRole("button", { name: /第 1 轮/ });
  await firstTurn.click();
  const firstMessage = page.locator('[data-message-id="navigation-user-1"]');
  await expect(firstMessage).toHaveAttribute("data-turn-navigation-target", "true");
  await expect(firstMessage).toBeInViewport();
  await expect(firstTurn).toHaveAttribute("aria-current", "step");
});
