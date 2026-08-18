import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";
import type { ShellEnvResolution } from "./shell-env";

const WINDOWS_PATH_DELIMITER = ";";
const WINDOWS_SYSTEM_ENV_KEY =
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";
const WINDOWS_USER_ENV_KEY = "HKCU\\Environment";
const WINDOWS_GIT_MACHINE_KEY = "HKLM\\SOFTWARE\\GitForWindows";
const WINDOWS_GIT_USER_KEY = "HKCU\\SOFTWARE\\GitForWindows";

type WindowsGitBashResolutionOptions = {
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
  pathExists?: (candidate: string) => boolean;
  readRegistryValue?: (key: string, valueName: string) => string | undefined;
  findOnPath?: (executable: string) => string[];
  verifyBash?: (candidate: string) => boolean;
};

type WindowsEnvironmentResolutionOptions = {
  env?: Record<string, string | undefined>;
  pathExists?: (candidate: string) => boolean;
  readRegistryValue?: (key: string, valueName: string) => string | undefined;
  resolveGitBash?: (
    env: Readonly<Record<string, string | undefined>>
  ) => string | undefined;
};

function getEnvValue(
  env: Readonly<Record<string, string | undefined>>,
  key: string
): string | undefined {
  const exact = env[key];
  if (exact) return exact;
  const matchedKey = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase()
  );
  return matchedKey ? env[matchedKey] : undefined;
}

/** 解析 reg query 输出中的单个值，兼容 REG_SZ 与 REG_EXPAND_SZ。 */
export function parseWindowsRegistryValue(
  output: string,
  valueName: string
): string | undefined {
  const escapedName = valueName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^\\s*${escapedName}\\s+REG_\\w+\\s+(.+?)\\s*$`,
    "i"
  );

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function readWindowsRegistryValue(
  key: string,
  valueName: string
): string | undefined {
  try {
    const result = spawnSync("reg.exe", ["query", key, "/v", valueName], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) return undefined;
    return parseWindowsRegistryValue(result.stdout, valueName);
  } catch {
    return undefined;
  }
}

function expandWindowsEnvVariables(
  value: string,
  env: Readonly<Record<string, string | undefined>>
): string {
  return value.replace(/%([^%]+)%/g, (original, name: string) => {
    return getEnvValue(env, name) ?? original;
  });
}

function normalizeWindowsPathForComparison(value: string): string {
  return value.replace(/^"|"$/g, "").replace(/[\\/]+$/, "").toLowerCase();
}

export function mergeWindowsRegistryPaths(
  registryPaths: readonly string[],
  currentEnv: Readonly<Record<string, string | undefined>>,
  pathExists: (candidate: string) => boolean = existsSync
): { path: string; importedCount: number } {
  const currentPath = getEnvValue(currentEnv, "PATH") ?? "";
  const currentEntries = currentPath
    .split(WINDOWS_PATH_DELIMITER)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const knownEntries = new Set(
    currentEntries.map(normalizeWindowsPathForComparison)
  );
  const importedEntries: string[] = [];

  for (const registryPath of registryPaths) {
    for (const rawEntry of registryPath.split(WINDOWS_PATH_DELIMITER)) {
      const entry = expandWindowsEnvVariables(
        rawEntry.trim().replace(/^"|"$/g, ""),
        currentEnv
      );
      if (!entry || !pathExists(entry)) continue;
      const normalized = normalizeWindowsPathForComparison(entry);
      if (knownEntries.has(normalized)) continue;
      knownEntries.add(normalized);
      importedEntries.push(entry);
    }
  }

  return {
    path: [...importedEntries, ...currentEntries].join(WINDOWS_PATH_DELIMITER),
    importedCount: importedEntries.length,
  };
}

function findWindowsExecutables(executable: string): string[] {
  try {
    const result = spawnSync("where.exe", [executable], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) return [];
    return result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function verifyWindowsBash(candidate: string): boolean {
  if (!existsSync(candidate)) return false;
  try {
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * 自动定位 Windows Bash。优先尊重显式配置，随后检查包管理器、
 * Git for Windows 注册表、标准安装目录和 PATH。
 */
export function resolveWindowsGitBashPath(
  options: WindowsGitBashResolutionOptions = {}
): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return undefined;

  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;
  const readRegistryValue =
    options.readRegistryValue ?? readWindowsRegistryValue;
  const findOnPath = options.findOnPath ?? findWindowsExecutables;
  const verifyBash = options.verifyBash ?? verifyWindowsBash;
  const candidates: string[] = [];

  const explicitPath = getEnvValue(env, "CLAUDE_CODE_GIT_BASH_PATH");
  if (explicitPath) candidates.push(explicitPath);

  const scoop = getEnvValue(env, "SCOOP");
  const localAppData = getEnvValue(env, "LOCALAPPDATA");
  if (scoop) {
    candidates.push(
      win32.join(scoop, "apps", "git", "current", "bin", "bash.exe"),
      win32.join(scoop, "apps", "git", "current", "usr", "bin", "bash.exe")
    );
  }
  if (localAppData) {
    candidates.push(
      win32.join(
        localAppData,
        "scoop",
        "apps",
        "git",
        "current",
        "bin",
        "bash.exe"
      ),
      win32.join(
        localAppData,
        "scoop",
        "apps",
        "git",
        "current",
        "usr",
        "bin",
        "bash.exe"
      ),
      win32.join(localAppData, "Programs", "Git", "bin", "bash.exe"),
      win32.join(localAppData, "Programs", "Git", "usr", "bin", "bash.exe")
    );
  }

  for (const key of [WINDOWS_GIT_MACHINE_KEY, WINDOWS_GIT_USER_KEY]) {
    const installPath = readRegistryValue(key, "InstallPath");
    if (installPath) {
      candidates.push(
        win32.join(installPath, "bin", "bash.exe"),
        win32.join(installPath, "usr", "bin", "bash.exe")
      );
    }
  }

  const programFiles = getEnvValue(env, "ProgramFiles") ?? "C:\\Program Files";
  const programFilesX86 =
    getEnvValue(env, "ProgramFiles(x86)") ?? "C:\\Program Files (x86)";
  for (const root of [programFiles, programFilesX86]) {
    candidates.push(
      win32.join(root, "Git", "bin", "bash.exe"),
      win32.join(root, "Git", "usr", "bin", "bash.exe")
    );
  }

  for (const gitPath of findOnPath("git.exe")) {
    const gitRoot = win32.dirname(win32.dirname(gitPath));
    candidates.push(
      win32.join(gitRoot, "bin", "bash.exe"),
      win32.join(gitRoot, "usr", "bin", "bash.exe")
    );
  }
  const bashPaths = findOnPath("bash.exe");
  candidates.push(
    ...bashPaths.filter((candidate) => candidate.toLowerCase().includes("git")),
    ...bashPaths.filter((candidate) => !candidate.toLowerCase().includes("git"))
  );

  const visited = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeWindowsPathForComparison(candidate);
    if (visited.has(normalized)) continue;
    visited.add(normalized);
    if (pathExists(candidate) && verifyBash(candidate)) return candidate;
  }
  return undefined;
}

/** 读取 Windows 注册表环境并更新 Zora 当前进程。不会写入注册表。 */
export function resolveWindowsEnvironment(
  options: WindowsEnvironmentResolutionOptions = {}
): ShellEnvResolution {
  try {
    const env = options.env ?? process.env;
    const pathExists = options.pathExists ?? existsSync;
    const readRegistryValue =
      options.readRegistryValue ?? readWindowsRegistryValue;
    const registryPaths = [
      readRegistryValue(WINDOWS_SYSTEM_ENV_KEY, "Path"),
      readRegistryValue(WINDOWS_USER_ENV_KEY, "Path"),
    ].filter((value): value is string => Boolean(value));
    const merged = mergeWindowsRegistryPaths(registryPaths, env, pathExists);
    env.PATH = merged.path;

    const shellPath = options.resolveGitBash
      ? options.resolveGitBash(env)
      : resolveWindowsGitBashPath({
          platform: "win32",
          env,
          pathExists,
          readRegistryValue,
        });
    if (shellPath) {
      env.CLAUDE_CODE_GIT_BASH_PATH = shellPath;
    } else {
      delete env.CLAUDE_CODE_GIT_BASH_PATH;
    }

    return {
      status: "loaded",
      importedCount: merged.importedCount + (shellPath ? 1 : 0),
      ...(shellPath ? { shellPath } : {}),
    };
  } catch (error) {
    return {
      status: "fallback",
      importedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
