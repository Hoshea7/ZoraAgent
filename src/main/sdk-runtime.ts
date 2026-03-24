import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { app } from "electron";

export interface SDKRuntimeOptions {
  executable: "bun" | "node" | "deno";
  executableArgs: string[];
  pathToClaudeCodeExecutable: string;
  env: Record<string, string>;
}

function hasCommandOnPath(commandName: string): boolean {
  const currentPath = process.env.PATH;
  if (!currentPath) {
    return false;
  }

  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT?.split(";").filter(Boolean) ?? [".EXE", ".CMD", ".BAT", ""])
      : [""];

  for (const dir of currentPath.split(delimiter)) {
    if (!dir) {
      continue;
    }

    for (const extension of extensions) {
      const candidate = join(dir, `${commandName}${extension}`);
      if (existsSync(candidate)) {
        return true;
      }
    }
  }

  return false;
}

export function resolveSDKCliPath(): string {
  const cjsRequire = createRequire(__filename);
  let cliPath: string | null = null;

  try {
    cliPath = cjsRequire.resolve("@anthropic-ai/claude-agent-sdk/cli.js");
  } catch {
    try {
      const sdkEntryPath = cjsRequire.resolve("@anthropic-ai/claude-agent-sdk");
      cliPath = join(dirname(sdkEntryPath), "cli.js");
    } catch {
      cliPath = join(
        process.cwd(),
        "node_modules",
        "@anthropic-ai",
        "claude-agent-sdk",
        "cli.js"
      );
    }
  }

  if (app.isPackaged && cliPath.includes(".asar")) {
    cliPath = cliPath.replace(/\.asar([/\\])/, ".asar.unpacked$1");
  }

  return cliPath;
}

export function getBundledBunDir(): string | null {
  const platformArch = `${process.platform}-${process.arch}`;

  if (app.isPackaged) {
    const bundledPath = join(process.resourcesPath, "bun", platformArch);
    if (existsSync(bundledPath)) {
      return bundledPath;
    }
  } else {
    const devPath = join(app.getAppPath(), "vendor", "bun", platformArch);
    if (existsSync(devPath)) {
      return devPath;
    }
  }

  return null;
}

export function getPackagedSafeWorkingDirectory(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

function getBunExecutablePath(): string | null {
  const bunDir = getBundledBunDir();
  if (!bunDir) {
    return null;
  }

  const executableName = process.platform === "win32" ? "bun.exe" : "bun";
  const executablePath = join(bunDir, executableName);
  return existsSync(executablePath) ? executablePath : null;
}

export function getSDKPathPrefix(): string {
  const bunDir = getBundledBunDir();
  return bunDir ? `${bunDir}${delimiter}` : "";
}

export function injectBunPath(env: Record<string, string>): Record<string, string> {
  const prefix = getSDKPathPrefix();
  if (!prefix) {
    return env;
  }

  const currentPath = env.PATH || process.env.PATH || "";
  return {
    ...env,
    PATH: `${prefix}${currentPath}`,
  };
}

export function getSDKRuntimeOptions(): SDKRuntimeOptions {
  const pathToClaudeCodeExecutable = resolveSDKCliPath();
  const bundledBunPath = getBunExecutablePath();

  if (bundledBunPath) {
    return {
      executable: "bun",
      executableArgs: [],
      pathToClaudeCodeExecutable,
      env: injectBunPath({}),
    };
  }

  if (hasCommandOnPath("bun")) {
    return {
      executable: "bun",
      executableArgs: [],
      pathToClaudeCodeExecutable,
      env: {},
    };
  }

  return {
    executable: "node",
    executableArgs: [],
    pathToClaudeCodeExecutable,
    env: {},
  };
}
