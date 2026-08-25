import { E2E_COVERAGE, expect, test } from "./support/electron-fixture";

const WORKSPACE_ID = "markdown-theme-workspace";
const SESSION_ID = "markdown-theme-session";
const NOW = "2026-08-14T04:00:00.000Z";

test.use({
  workspaceSeed: {
    id: WORKSPACE_ID,
    name: "正文主题测试",
    createdAt: NOW,
    updatedAt: NOW,
    sessions: [
      {
        id: SESSION_ID,
        title: "正文主题色",
        createdAt: NOW,
        updatedAt: NOW,
        permissionMode: "ask" as const,
      },
    ],
    sessionMessages: {
      [SESSION_ID]: [
        {
          id: "markdown-theme-assistant",
          role: "assistant" as const,
          text: [
            "1. **重点内容** 补充说明",
            "2. 第二条内容",
            "",
            "- 普通条目",
          ].join("\n"),
          timestamp: Date.parse(NOW),
        },
      ],
    },
  },
});

test("正文序号和项目符号使用主题色", E2E_COVERAGE.productLocal, async ({ page }) => {
  await page.getByRole("button", { name: "正文主题测试", exact: true }).click();
  await page.getByRole("button", { name: /^正文主题色/ }).click();

  const message = page.locator(".ai-message-content").last();
  const orderedList = message.locator("ol");
  const unorderedList = message.locator("ul");

  await expect(orderedList).toBeVisible();
  await expect(unorderedList).toBeVisible();

  const [orderedMarkerColor, unorderedMarkerColor, brandColor, mutedBrandColor] =
    await message.evaluate((element) => {
      const orderedItem = element.querySelector("ol > li");
      const unorderedItem = element.querySelector("ul > li");
      const rootStyle = getComputedStyle(document.documentElement);

      return [
        orderedItem ? getComputedStyle(orderedItem, "::marker").color : "",
        unorderedItem ? getComputedStyle(unorderedItem, "::marker").color : "",
        rootStyle.getPropertyValue("--color-brand").trim(),
        rootStyle.getPropertyValue("--color-brand-muted").trim(),
      ];
    });

  expect(orderedMarkerColor).toBe("rgb(201, 120, 73)");
  expect(unorderedMarkerColor).toBe("rgb(232, 196, 160)");
  expect(brandColor).toBe("#c97849");
  expect(mutedBrandColor).toBe("#e8c4a0");
});
