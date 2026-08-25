import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  E2E_COVERAGE,
  RUNTIMES,
  expect,
  expectAssistantTextUntilSettled,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

const PROBE_SERVER = path.resolve(
  __dirname,
  "fixtures/mcp-probe-server.mjs"
);

for (const runtime of RUNTIMES) {
  test(`[${runtime}] 用户启用的 stdio MCP 可被 Agent 调用`, E2E_COVERAGE.agentProvider, async ({
    electronApp,
    page,
  }) => {
    test.setTimeout(180_000);
    const probeValue = `ZORA_CUSTOM_MCP_${runtime.toUpperCase()}_7788`;
    const zoraHome = await electronApp.evaluate(() => process.env.ZORA_HOME);
    expect(zoraHome).toBeTruthy();
    await writeFile(
      path.join(zoraHome!, "mcp.json"),
      `${JSON.stringify({
        servers: {
          zora_probe: {
            type: "stdio",
            command: process.execPath,
            args: [PROBE_SERVER],
            env: { ZORA_MCP_PROBE_VALUE: probeValue },
            enabled: true,
          },
        },
      }, null, 2)}\n`,
      "utf8"
    );

    await selectRuntime(page, runtime);
    const previousAssistantCount = await page
      .locator("[data-assistant-message='true']")
      .count();
    await sendMessage(
      page,
      "请调用 mcp__zora_probe__read_probe_value 工具，并只回复工具返回的公开 E2E 测试值。"
    );

    await expect(page.locator(".ai-process-content")).toContainText(
      /mcp__zora_probe__read_probe_value/i,
      { timeout: 120_000 }
    );
    await expect(page.getByRole("heading", {
      name: /需要 Mcp__zora_probe__read_probe_value 执行权限/,
    })).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "允许", exact: true }).click();
    await expectAssistantTextUntilSettled(
      page,
      probeValue,
      previousAssistantCount,
      120_000,
    );
  });
}
