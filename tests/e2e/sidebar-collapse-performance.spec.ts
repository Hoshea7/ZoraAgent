import { E2E_COVERAGE, expect, test } from "./support/electron-fixture";

const WORKSPACE_ID = "sidebar-collapse-performance-project";
const SESSION_ID = "sidebar-collapse-performance-session";
const NOW = "2026-09-03T08:00:00.000Z";
const MESSAGE_TEXT = [
  "## 会话折叠性能测试",
  "",
  "这段内容用于验证侧边栏折叠期间，正文排版不会在每一帧重新计算。",
  "",
  "- 保持消息区域的阅读宽度稳定",
  "- 保持当前滚动位置稳定",
  "- 侧边栏边界连续移动",
].join("\n");

test.use({
  workspaceSeed: {
    id: WORKSPACE_ID,
    name: "侧边栏性能测试",
    createdAt: NOW,
    updatedAt: NOW,
    sessions: [
      {
        id: SESSION_ID,
        title: "长会话折叠测试",
        createdAt: NOW,
        updatedAt: NOW,
        permissionMode: "ask" as const,
      },
    ],
    sessionMessages: {
      [SESSION_ID]: Array.from({ length: 48 }, (_, index) => ({
        id: `sidebar-performance-message-${index}`,
        role: "assistant" as const,
        text: `${MESSAGE_TEXT}\n\n第 ${index + 1} 条记录。`,
        timestamp: Date.parse(NOW) + index,
      })),
    },
  },
});

test(
  "侧边栏折叠期间正文只进行一次布局切换",
  E2E_COVERAGE.productLocal,
  async ({ page }) => {
    await page.getByRole("button", { name: "侧边栏性能测试", exact: true }).click();
    await page.getByText("长会话折叠测试", { exact: true }).click();

    const messageViewport = page.locator('[data-message-scroll-container="true"]');
    await expect(messageViewport).toBeVisible();

    const result = await page.evaluate(async () => {
      const viewport = document.querySelector<HTMLElement>(
        '[data-message-scroll-container="true"]',
      );
      const collapseButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="折叠侧边栏"]',
      );
      const sidebarEdge = document.querySelector<HTMLElement>(
        '[data-testid="sidebar-visual-edge"]',
      );
      const workspaceShell = document.querySelector<HTMLElement>(
        '[data-testid="workspace-shell"]',
      );

      if (!viewport || !collapseButton || !sidebarEdge || !workspaceShell) {
        throw new Error("缺少侧边栏折叠性能采样节点");
      }

      const widths: number[] = [];
      const frameIntervals: number[] = [];
      const boundaryGaps: number[] = [];

      await new Promise<void>((resolve) => {
        const startedAt = performance.now();
        let previousFrameAt = startedAt;

        const sample = (frameAt: number) => {
          widths.push(Math.round(viewport.getBoundingClientRect().width));
          frameIntervals.push(frameAt - previousFrameAt);
          boundaryGaps.push(
            Math.abs(
              workspaceShell.getBoundingClientRect().left -
                sidebarEdge.getBoundingClientRect().left,
            ),
          );
          previousFrameAt = frameAt;

          if (frameAt - startedAt >= 280) {
            resolve();
            return;
          }

          requestAnimationFrame(sample);
        };

        requestAnimationFrame(sample);
        collapseButton.click();
      });

      return {
        distinctWidths: new Set(widths).size,
        maxFrameInterval: Math.max(...frameIntervals),
        maxBoundaryGap: Math.max(...boundaryGaps),
      };
    });

    expect(
      result.distinctWidths,
      `折叠过程中正文出现 ${result.distinctWidths} 个宽度，最大帧间隔 ${result.maxFrameInterval.toFixed(1)}ms`,
    ).toBeLessThanOrEqual(2);
    expect(
      result.maxBoundaryGap,
      `侧边栏与正文之间出现 ${result.maxBoundaryGap.toFixed(1)}px 的断层`,
    ).toBeLessThanOrEqual(2);
  },
);
