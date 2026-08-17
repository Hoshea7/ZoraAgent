import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyFallbackPaths,
  mergeShellEnv,
  parseShellEnvOutput,
} from "@/main/shell-env";

const MARKER = "__ZORA_SHELL_ENV_START__";

describe("parseShellEnvOutput", () => {
  it("parses KEY=VALUE lines after the marker", () => {
    const output = [
      "welcome noise from .zshrc",
      MARKER,
      "HOME=/Users/dev",
      "PATH=/opt/homebrew/bin:/usr/bin:/bin",
      "API_KEY=secret==value",
      "",
    ].join("\n");

    const env = parseShellEnvOutput(output);

    expect(env.HOME).toBe("/Users/dev");
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
    // value 中的 '=' 不被截断
    expect(env.API_KEY).toBe("secret==value");
  });

  it("returns empty object when marker is missing", () => {
    expect(parseShellEnvOutput("no marker here\nFOO=bar")).toEqual({});
  });

  it("drops excluded variables", () => {
    const output = [
      MARKER,
      "HOME=/Users/dev",
      "ELECTRON_RUN_AS_NODE=1",
      "SHLVL=2",
      "PWD=/Users/dev",
      "TERM_PROGRAM=iTerm.app",
      "VITE_DEV_SERVER_URL=http://localhost:5173",
      "npm_lifecycle_event=test",
      "BUN_INSTALL=/Users/dev/.bun",
      "MY_VAR=keep",
    ].join("\n");

    const env = parseShellEnvOutput(output);

    expect(env).toEqual({ HOME: "/Users/dev", MY_VAR: "keep" });
  });
});

describe("mergeShellEnv", () => {
  it("prepends shell PATH entries and deduplicates", () => {
    const merged = mergeShellEnv(
      { PATH: "/opt/homebrew/bin:/usr/bin:/bin" },
      { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }
    );

    expect(merged.PATH).toBe(
      "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    );
  });

  it("does not overwrite existing non-PATH variables", () => {
    const merged = mergeShellEnv(
      { HOME: "/new", NEW_VAR: "value" },
      { HOME: "/existing" }
    );

    expect(merged.HOME).toBeUndefined();
    expect(merged.NEW_VAR).toBe("value");
  });

  it("fills in non-PATH variables missing from current env", () => {
    const merged = mergeShellEnv(
      { CARGO_HOME: "/Users/dev/.cargo" },
      { PATH: "/usr/bin" }
    );

    expect(merged.CARGO_HOME).toBe("/Users/dev/.cargo");
  });
});

describe("applyFallbackPaths", () => {
  it("prepends existing fallback dirs and deduplicates", () => {
    const home = mkdtempSync(path.join(tmpdir(), "zora-shell-env-test-"));
    try {
      const localBin = path.join(home, ".local", "bin");
      mkdirSync(localBin, { recursive: true });
      writeFileSync(path.join(localBin, ".keep"), "");

      const result = applyFallbackPaths(
        { PATH: "/usr/bin:/bin" },
        home
      );

      // 真实系统目录（homebrew 等）存在与否取决于机器，只断言确定性行为：
      // ~/.local/bin 被加入，已有条目去重保留
      expect(result.PATH).toContain(localBin);
      const entries = result.PATH!.split(":");
      expect(new Set(entries).size).toBe(entries.length);
      expect(entries).toContain("/usr/bin");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps current PATH when no fallback dirs exist", () => {
    const emptyHome = mkdtempSync(path.join(tmpdir(), "zora-shell-env-empty-"));
    try {
      const result = applyFallbackPaths({ PATH: "/usr/bin:/bin" }, emptyHome);
      // 用户级目录不存在，系统级目录（/usr/local/bin 等）在 macOS CI 上通常存在，
      // 只断言原有条目保留
      expect(result.PATH).toContain("/usr/bin");
      expect(result.PATH).toContain("/bin");
    } finally {
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
