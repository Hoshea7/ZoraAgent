/**
 * 桌面 GUI Shell 环境解析
 *
 * macOS 从登录 shell 导入环境。Windows 从注册表读取最新的用户级和
 * 系统级 PATH，并自动定位 Git for Windows 自带的 bash.exe。
 * 所有修改只作用于 Zora 当前进程及其子进程，不写入用户系统配置。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter } from "node:path";
import { resolveWindowsEnvironment } from "./windows-shell-env";

const ENV_MARKER = "__ZORA_SHELL_ENV_START__";
const SHELL_ENV_TIMEOUT_MS = 3000;

/** 不从登录 shell 环境导入的变量，防止干扰 Electron 应用自身运行 */
const EXCLUDED_ENV_KEYS = new Set([
  // Electron/Node 内部变量，不能被覆盖
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ASAR",
  // shell 会话内部状态
  "SHLVL",
  "PWD",
  "OLDPWD",
  "_",
  // 终端会话变量
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_SESSION_ID",
  "LINES",
  "COLUMNS",
]);

const EXCLUDED_ENV_KEY_PREFIXES = ["VITE_", "npm_", "BUN_"];

export type ShellEnvResolution = {
  status: "loaded" | "fallback" | "skipped";
  importedCount: number;
  error?: string;
  shellPath?: string;
};

function isExcludedKey(key: string): boolean {
  if (EXCLUDED_ENV_KEYS.has(key)) return true;
  return EXCLUDED_ENV_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * 解析登录 shell 输出。marker 之前的内容（.zshrc 的欢迎语等噪音）
 * 全部丢弃，只解析 marker 之后的 KEY=VALUE 行。
 */
export function parseShellEnvOutput(output: string): Record<string, string> {
  const markerIndex = output.indexOf(ENV_MARKER);
  if (markerIndex === -1) return {};

  const envSection = output.slice(markerIndex + ENV_MARKER.length);
  const env: Record<string, string> = {};

  for (const line of envSection.split("\n")) {
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex);
    if (isExcludedKey(key)) continue;
    env[key] = line.slice(eqIndex + 1);
  }

  return env;
}

/**
 * 合并登录 shell 环境与当前环境，返回需要写入的增量：
 * - PATH：登录 shell 的条目前置（优先级更高），去重合并
 * - 其他变量：只在当前环境缺失或为空时填充，不覆盖应用已设置的值
 */
export function mergeShellEnv(
  shellEnv: Record<string, string>,
  currentEnv: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const merged: Record<string, string> = {};

  for (const [key, value] of Object.entries(shellEnv)) {
    if (key === "PATH") continue;
    if (!currentEnv[key]) {
      merged[key] = value;
    }
  }

  if (shellEnv.PATH) {
    const shellPaths = shellEnv.PATH.split(delimiter).filter(Boolean);
    const currentPaths = (currentEnv.PATH ?? "").split(delimiter).filter(Boolean);
    merged.PATH = [...new Set([...shellPaths, ...currentPaths])].join(delimiter);
  }

  return merged;
}

function fallbackPathEntries(home: string): string[] {
  return [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    `${home}/.local/bin`,
    `${home}/.bun/bin`,
    `${home}/.cargo/bin`,
  ].filter((entry) => existsSync(entry));
}

/**
 * 登录 shell 解析失败时的兜底：把常见工具目录前置进 PATH。
 */
export function applyFallbackPaths(
  currentEnv: Readonly<Record<string, string | undefined>>,
  home = homedir()
): Record<string, string> {
  const currentPaths = (currentEnv.PATH ?? "").split(delimiter).filter(Boolean);
  const fallbacks = fallbackPathEntries(home);
  return {
    PATH: [...new Set([...fallbacks, ...currentPaths])].join(delimiter),
  };
}

function runLoginShellEnv(shell: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell, ["-l", "-i", "-c", `echo ${ENV_MARKER} && env`], {
      timeout: SHELL_ENV_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        // 最小初始环境：防止 shell 启动脚本行为异常，
        // 同时保留基础 PATH 供 .zshrc 里的外部命令使用
        HOME: process.env.HOME ?? homedir(),
        USER: process.env.USER ?? "",
        SHELL: shell,
        TERM: "xterm-256color",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        // 防止 shell 启动脚本触发 git 凭证交互
        GIT_TERMINAL_PROMPT: "0",
      },
    });

    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`登录 shell 环境解析超时（${SHELL_ENV_TIMEOUT_MS}ms）`));
    }, SHELL_ENV_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`登录 shell 退出码非零: ${code}`));
      }
    });
  });
}

/**
 * 解析登录 shell 环境并应用到 process.env。
 *
 * 执行条件：macOS 且打包模式。开发模式从终端启动，已继承完整环境，直接跳过。
 * 其他平台（Windows GUI 继承注册表 PATH，不存在此问题）同样跳过。
 * 解析失败时应用 fallback 路径表，保证最坏情况下主流工具仍可找到。
 */
export async function resolveShellEnv(): Promise<ShellEnvResolution> {
  if (process.platform === "win32") {
    return resolveWindowsEnvironment();
  }
  if (process.platform !== "darwin") {
    return { status: "skipped", importedCount: 0 };
  }
  // 与 index.ts 的 dev 判断保持一致
  if (process.env.VITE_DEV_SERVER_URL) {
    return { status: "skipped", importedCount: 0 };
  }

  const shell = process.env.SHELL || "/bin/zsh";

  try {
    const output = await runLoginShellEnv(shell);
    const shellEnv = parseShellEnvOutput(output);
    const merged = mergeShellEnv(shellEnv, process.env);
    for (const [key, value] of Object.entries(merged)) {
      process.env[key] = value;
    }
    return { status: "loaded", importedCount: Object.keys(merged).length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = applyFallbackPaths(process.env);
    for (const [key, value] of Object.entries(fallback)) {
      process.env[key] = value;
    }
    return { status: "fallback", importedCount: 0, error: message };
  }
}
