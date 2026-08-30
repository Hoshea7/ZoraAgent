import { E2E_COVERAGE, expect, test } from "./support/electron-fixture";
import type { Locator, Page } from "@playwright/test";

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
      {
        id: "markdown-reading-empty-session",
        title: "空白会话",
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

async function selectVisibleText(
  page: Page,
  locator: Locator,
  width = 180,
) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + Math.min(box!.width - 4, width), y, {
    steps: 12,
  });
  await page.mouse.up();
}

test("代码块保留源代码换行和缩进", E2E_COVERAGE.productLocal, async ({ page }) => {
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

test("用户划词添加批注并作为消息发送", E2E_COVERAGE.productLocal, async ({ page }) => {
  await page.getByRole("button", { name: "正文排版测试", exact: true }).click();
  await page.getByText("正文排版", { exact: true }).click();

  const paragraph = page.getByText(
    "段落内容用于验证连续阅读宽度与行距。",
    { exact: true },
  );
  await selectVisibleText(page, paragraph);

  const addAnnotation = page.getByRole("button", { name: "添加批注" });
  const selectionRect = await page.evaluate(() => {
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { top: rect.top, left: rect.left, right: rect.right };
  });
  await expect(addAnnotation).toBeVisible();
  const cardBox = await addAnnotation.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(selectionRect.top);
  expect(cardBox!.x + cardBox!.width / 2).toBeGreaterThan(selectionRect.left);
  expect(cardBox!.x + cardBox!.width / 2).toBeLessThan(selectionRect.right);
  const cardRadius = await addAnnotation.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).borderRadius),
  );
  expect(cardRadius).toBeLessThan(cardBox!.height / 2);
  const activeHighlight = page.getByTestId(
    "active-response-annotation-highlight",
  );
  await expect(activeHighlight).toHaveCount(0);

  await page.getByRole("heading", { name: "正文层级" }).click();
  expect(await addAnnotation.count()).toBe(0);
  await selectVisibleText(page, paragraph);

  await addAnnotation.click();
  const annotationEditor = page.getByRole("textbox", { name: "批注评论" });
  await expect(annotationEditor).toBeFocused();
  const editorCard = page.getByTestId("response-annotation-popover");
  const initialEditorCardBox = await editorCard.boundingBox();
  expect(initialEditorCardBox).not.toBeNull();
  expect(initialEditorCardBox!.height).toBeLessThan(120);
  expect(initialEditorCardBox!.x).toBeGreaterThan(selectionRect.right);
  expect(initialEditorCardBox!.y + initialEditorCardBox!.height).toBeLessThan(
    selectionRect.top,
  );
  await expect(activeHighlight).not.toHaveCount(0);
  const activeHighlightStyle = await activeHighlight.first().evaluate(
    (element) => ({
      backgroundColor: getComputedStyle(element).backgroundColor,
      boxShadow: getComputedStyle(element).boxShadow,
      zIndex: getComputedStyle(element).zIndex,
    }),
  );
  expect(activeHighlightStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(activeHighlightStyle.boxShadow).not.toBe("none");
  expect(activeHighlightStyle.zIndex).toBe("0");
  await expect(page.getByTestId("response-annotation-content")).toHaveCSS(
    "z-index",
    "1",
  );
  await annotationEditor.fill("第一行评论\n第二行评论\n第三行评论");
  const expandedEditorCardBox = await editorCard.boundingBox();
  expect(expandedEditorCardBox).not.toBeNull();
  expect(expandedEditorCardBox!.height).toBeGreaterThan(
    initialEditorCardBox!.height,
  );
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByTestId("saved-response-annotation-underline")).not.toHaveCount(0);

  const composerAnnotations = page.getByTestId("draft-response-annotations");
  await expect(composerAnnotations).toContainText("1 条批注");
  const marker = page.getByTestId("response-annotation-marker");
  await expect(marker).toHaveText("1");
  const markerBox = await marker.boundingBox();
  expect(markerBox).not.toBeNull();
  expect(markerBox!.x).toBeGreaterThan(selectionRect.right);
  expect(markerBox!.y).toBeLessThanOrEqual(selectionRect.top + 2);
  await expect(activeHighlight).toHaveCount(0);

  await page.getByTitle("发送").click();

  await expect(composerAnnotations).toHaveCount(0);
  await expect(page.getByTestId("response-annotation-marker")).toHaveCount(0);
  await expect(page.getByTestId("saved-response-annotation-underline")).toHaveCount(0);
  await expect(
    page.getByText("请基于以下评论批注内容给出反馈。", { exact: true }),
  ).toBeVisible();

  const sentAnnotations = page.locator("article").filter({
    hasText: "请基于以下评论批注内容给出反馈。",
  });
  const sentAnnotationSummary = sentAnnotations.getByText("1 条批注", {
    exact: true,
  });
  await page.locator("[data-message-scroll-container='true']").evaluate(
    (element) => {
      element.scrollTop = element.scrollHeight;
    },
  );
  const [summaryBoxBeforeExpand, scrollTopBeforeExpand] = await Promise.all([
    sentAnnotationSummary.boundingBox(),
    page.locator("[data-message-scroll-container='true']").evaluate(
      (element) => element.scrollTop,
    ),
  ]);
  expect(summaryBoxBeforeExpand).not.toBeNull();

  await sentAnnotationSummary.click();
  await expect(sentAnnotations).toContainText("段落内容");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const [summaryBoxAfterExpand, scrollTopAfterExpand] = await Promise.all([
    sentAnnotationSummary.boundingBox(),
    page.locator("[data-message-scroll-container='true']").evaluate(
      (element) => element.scrollTop,
    ),
  ]);
  expect(summaryBoxAfterExpand).not.toBeNull();
  expect(
    Math.abs(summaryBoxAfterExpand!.y - summaryBoxBeforeExpand!.y),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(scrollTopAfterExpand - scrollTopBeforeExpand),
  ).toBeLessThanOrEqual(1);

  await page.reload();
  await page.getByRole("button", { name: "正文排版测试", exact: true }).click();
  await page.getByText("正文排版", { exact: true }).click();
  const persistedMessage = page.locator("article").filter({
    hasText: "请基于以下评论批注内容给出反馈。",
  });
  await expect(persistedMessage).toBeVisible();
  await persistedMessage.getByText("1 条批注", { exact: true }).click();
  await expect(persistedMessage).toContainText("段落内容");
});

test("用户管理多条批注并跨会话保留草稿", E2E_COVERAGE.productLocal, async ({ page }) => {
  await page.getByRole("button", { name: "正文排版测试", exact: true }).click();
  await page.getByText("正文排版", { exact: true }).click();

  const paragraph = page.getByText(
    "段落内容用于验证连续阅读宽度与行距。",
    { exact: true },
  );
  await selectVisibleText(page, paragraph);
  await page.getByRole("button", { name: "添加批注" }).click();
  await page.getByRole("textbox", { name: "批注评论" }).fill("调整段落表达");
  await page.getByRole("button", { name: "添加", exact: true }).click();

  const heading = page.getByRole("heading", { name: "正文层级" });
  await selectVisibleText(page, heading, 100);
  await page.getByRole("button", { name: "添加批注" }).click();
  await page.getByRole("textbox", { name: "批注评论" }).fill("调整标题表达");
  await page.getByRole("button", { name: "添加", exact: true }).click();

  const composer = page.getByTestId("draft-response-annotations");
  await page.getByTestId("response-annotation-marker").first().click();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "删除批注" })).toBeVisible();
  await page.getByRole("button", { name: "删除批注" }).click();
  await expect(composer).toContainText("1 条批注");
  await expect(page.getByTestId("response-annotation-marker")).toHaveCount(1);

  await selectVisibleText(page, heading, 100);
  await page.getByRole("button", { name: "添加批注" }).click();
  await page.getByRole("textbox", { name: "批注评论" }).fill("调整标题表达");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(composer).toContainText("2 条批注");

  const composerBoxBeforeOpen = await composer.boundingBox();
  expect(composerBoxBeforeOpen).not.toBeNull();
  await composer.getByRole("button", { name: "2 条批注" }).click();
  const annotationPopover = page.getByTestId(
    "draft-response-annotations-popover",
  );
  await expect(annotationPopover).toBeVisible();
  const [composerBoxAfterOpen, annotationPopoverBox] = await Promise.all([
    composer.boundingBox(),
    annotationPopover.boundingBox(),
  ]);
  expect(composerBoxAfterOpen).not.toBeNull();
  expect(annotationPopoverBox).not.toBeNull();
  expect(composerBoxAfterOpen!.height).toBe(composerBoxBeforeOpen!.height);
  expect(annotationPopoverBox!.y + annotationPopoverBox!.height).toBeLessThan(
    composerBoxAfterOpen!.y,
  );
  const rows = annotationPopover
    .locator(".rounded-xl")
    .filter({ has: page.locator("p") });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("正文层级");
  await expect(rows.nth(1)).toContainText("段落内容");

  await annotationPopover.getByRole("button", { name: "编辑批注 1" }).click();
  const editor = page.getByRole("textbox", { name: "编辑批注 1" });
  await expect(editor).toHaveValue("调整标题表达");
  await editor.fill("调整整体标题");
  await annotationPopover.getByRole("button", { name: "保存批注 1" }).click();
  await expect(annotationPopover).toContainText("调整整体标题");

  await annotationPopover.getByRole("button", { name: "定位批注 2" }).click();
  await expect(annotationPopover).toHaveCount(0);
  await expect(page.getByTestId("response-annotation-marker").nth(1)).toHaveClass(
    /animate-pulse/,
  );
  await expect(
    page.getByTestId("response-annotation-location-highlight"),
  ).not.toHaveCount(0);
  await composer.getByRole("button", { name: "2 条批注" }).click();
  await expect(annotationPopover).toBeVisible();
  await annotationPopover.getByRole("button", { name: "删除批注 2" }).click();
  await expect(composer).toContainText("1 条批注");

  await page.getByText("空白会话", { exact: true }).click();
  await expect(page.getByTestId("draft-response-annotations")).toHaveCount(0);
  await page.getByText("正文排版", { exact: true }).click();
  await expect(page.getByTestId("draft-response-annotations")).toContainText(
    "1 条批注",
  );
  await expect(page.getByTestId("response-annotation-marker")).toHaveText("1");

  await page.getByTitle("发送").click();
  const sentMessage = page.locator("article").filter({
    hasText: "请基于以下评论批注内容给出反馈。",
  });
  await expect(sentMessage).toBeVisible();
  await sentMessage.getByText("1 条批注", { exact: true }).click();
  await expect(sentMessage).toContainText("调整整体标题");
});
