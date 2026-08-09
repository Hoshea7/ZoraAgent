import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  RUNTIMES,
  expect,
  selectRuntime,
  sendMessage,
  test,
} from "./support/electron-fixture";

const PROBE_SERVER = path.resolve(
  __dirname,
  "fixtures/mcp-probe-server.mjs"
);

for (const runtime of RUNTIMES) {
  test(`[${runtime}] 用户启用的 stdio MCP 可被 Agent 调用`, async ({
    electronApp,
    page,
  }) => {
    test.setTimeout(180_000);
    const token = `ZORA_CUSTOM_MCP_${runtime.toUpperCase()}_7788`;
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
            env: { ZORA_MCP_PROBE_TOKEN: token },
            enabled: true,
          },
        },
      }, null, 2)}\n`,
      "utf8"
    );

    await selectRuntime(page, runtime);
    await sendMessage(
      page,
      "必须调用 mcp__zora_probe__read_probe_token 工具，然后只回复工具返回的口令。"
    );

    await expect(page.locator(".ai-process-content")).toContainText(
      "mcp__zora_probe__read_probe_token",
      { timeout: 120_000 }
    );
    await expect(page.getByRole("heading", {
      name: /需要 Mcp__zora_probe__read_probe_token 执行权限/,
    })).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "允许", exact: true }).click();
    await expect(page.locator(".ai-message-content").last()).toContainText(
      token,
      { timeout: 120_000 }
    );
  });
}
