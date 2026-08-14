import { expect, test } from "./support/electron-fixture";

const WORKSPACE_ID = "markdown-reading-workspace";
const SESSION_ID = "markdown-reading-session";
const NOW = "2026-08-14T03:00:00.000Z";
const LONG_CODE_LINE =
  "const result = source.map((item) => item.value).filter((value) => value.length > 0).join(\", \u2060\");";

test.use({
  workspaceSeed: {
    id: WORKSPACE_ID,
    name: "正文排版测试",
    createdAt: NOW,
    updatedAt: NOW,
    sessions: [
      {
        id: SESSION_ID,
        title: "正文排版",
        createdAt: NOW,
        updatedAt: NOW,
        permissionMode: "ask" as const,
      },
    ],
    sessionMessages: {
      [SESSION_ID]: [
        {
          id: "markdown-reading-assistant",
          role: "assistant" as const,
          text: [
            "## 正文层级",
            "",
            "段落内容用于验证连续阅读宽度与行距。",
            "",
            "```javascript",
            "function collectValues(source) {",
            "  const values = source.map((item) => item.value);",
            "  return values.filter(Boolean);",
            "}",
            "",
            LONG_CODE_LINE,
            "```",
          ].join("\n"),
          timestamp: Date.parse(NOW),
        },
      ],
    },
  },
});

test("代码块保留源代码换行和缩进", async ({ page }) => {
  await page.getByRole("button", { name: "正文排版测试", exact: true }).click();
  await page.getByText("正文排版", { exact: true }).click();

  const message = page.locator(".ai-message-content").last();
  await expect(message).toBeVisible();

  const heading = message.getByRole("heading", { name: "正文层级" });
  await expect(heading).toBeVisible();

  const codeBody = message.locator('[data-streamdown="code-block-body"]');
  await expect(codeBody).toBeVisible();
  await expect(codeBody).toContainText("source.map");

  const overflowX = await codeBody.evaluate(
    (element) => getComputedStyle(element).overflowX,
  );
  const whiteSpace = await codeBody.locator("pre").evaluate(
    (element) => getComputedStyle(element).whiteSpace,
  );
  const sourceLines = codeBody.locator("pre > code > span");
  await expect
    .poll(() => sourceLines.count())
    .toBeGreaterThanOrEqual(5);
  const lineDisplays = await sourceLines.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).display),
  );
  const lineTops = await sourceLines.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().top),
  );

  expect(overflowX).toBe("auto");
  expect(whiteSpace).toBe("pre");
  expect(new Set(lineDisplays)).toEqual(new Set(["block"]));
  expect(lineTops[1]).toBeGreaterThan(lineTops[0]);
  expect(lineTops[2]).toBeGreaterThan(lineTops[1]);

  const codeHeader = message.locator('[data-streamdown="code-block-header"]');
  const copyButton = message.locator(
    '[data-streamdown="code-block-copy-button"]',
  );
  const [headerBox, copyBox] = await Promise.all([
    codeHeader.boundingBox(),
    copyButton.boundingBox(),
  ]);
  expect(headerBox).not.toBeNull();
  expect(copyBox).not.toBeNull();
  expect(
    Math.abs(
      headerBox!.y + headerBox!.height / 2 -
        (copyBox!.y + copyBox!.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
  expect(headerBox!.x + headerBox!.width - (copyBox!.x + copyBox!.width)).toBe(
    8,
  );
});
