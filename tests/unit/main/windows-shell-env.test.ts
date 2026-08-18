import {
  mergeWindowsRegistryPaths,
  parseWindowsRegistryValue,
  resolveWindowsEnvironment,
  resolveWindowsGitBashPath,
} from "@/main/windows-shell-env";

describe("Windows shell environment", () => {
  it("parses registry values containing spaces", () => {
    const output = [
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\GitForWindows",
      "    InstallPath    REG_SZ    D:\\Git\\Git",
      "",
    ].join("\r\n");

    expect(parseWindowsRegistryValue(output, "InstallPath")).toBe(
      "D:\\Git\\Git"
    );
  });

  it("merges existing registry PATH entries without changing system settings", () => {
    const existing = new Set(
      ["C:\\Windows\\System32", "D:\\Tools\\bin", "C:\\Existing"].map(
        (entry) => entry.toLowerCase()
      )
    );
    const result = mergeWindowsRegistryPaths(
      ["%SystemRoot%\\System32;D:\\Tools\\bin;C:\\Missing"],
      {
        PATH: "C:\\Existing;D:\\Tools\\bin",
        SystemRoot: "C:\\Windows",
      },
      (candidate) => existing.has(candidate.toLowerCase())
    );

    expect(result).toEqual({
      path: "C:\\Windows\\System32;C:\\Existing;D:\\Tools\\bin",
      importedCount: 1,
    });
  });

  it("finds Git Bash from a non-standard registry install path", () => {
    const bashPath = "D:\\Git\\Git\\bin\\bash.exe";
    const result = resolveWindowsGitBashPath({
      platform: "win32",
      env: {
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
      },
      readRegistryValue: (key, valueName) =>
        key === "HKLM\\SOFTWARE\\GitForWindows" && valueName === "InstallPath"
          ? "D:\\Git\\Git"
          : undefined,
      findOnPath: () => [],
      pathExists: (candidate) => candidate === bashPath,
      verifyBash: (candidate) => candidate === bashPath,
    });

    expect(result).toBe(bashPath);
  });

  it("derives Git Bash from git.exe found on PATH", () => {
    const bashPath = "E:\\PortableGit\\bin\\bash.exe";
    const result = resolveWindowsGitBashPath({
      platform: "win32",
      env: {},
      readRegistryValue: () => undefined,
      findOnPath: (executable) =>
        executable === "git.exe"
          ? ["E:\\PortableGit\\cmd\\git.exe"]
          : [],
      pathExists: (candidate) => candidate === bashPath,
      verifyBash: (candidate) => candidate === bashPath,
    });

    expect(result).toBe(bashPath);
  });

  it("prefers Git Bash when PATH also contains the legacy WSL launcher", () => {
    const gitBashPath = "D:\\Git\\Git\\bin\\bash.exe";
    const wslBashPath = "C:\\Windows\\System32\\bash.exe";
    const result = resolveWindowsGitBashPath({
      platform: "win32",
      env: {},
      readRegistryValue: () => undefined,
      findOnPath: (executable) =>
        executable === "bash.exe" ? [wslBashPath, gitBashPath] : [],
      pathExists: (candidate) =>
        candidate === gitBashPath || candidate === wslBashPath,
      verifyBash: () => true,
    });

    expect(result).toBe(gitBashPath);
  });

  it("loads registry PATH and exposes the detected Bash only to the app environment", () => {
    const env: Record<string, string | undefined> = {
      PATH: "C:\\Existing",
      SystemRoot: "C:\\Windows",
    };
    const existing = new Set(["C:\\Existing", "C:\\Windows\\System32"]);

    const result = resolveWindowsEnvironment({
      env,
      readRegistryValue: (key, valueName) =>
        key.includes("Session Manager") && valueName === "Path"
          ? "%SystemRoot%\\System32"
          : undefined,
      pathExists: (candidate) => existing.has(candidate),
      resolveGitBash: () => "D:\\Git\\Git\\bin\\bash.exe",
    });

    expect(result).toEqual({
      status: "loaded",
      importedCount: 2,
      shellPath: "D:\\Git\\Git\\bin\\bash.exe",
    });
    expect(env).toEqual({
      PATH: "C:\\Windows\\System32;C:\\Existing",
      SystemRoot: "C:\\Windows",
      CLAUDE_CODE_GIT_BASH_PATH: "D:\\Git\\Git\\bin\\bash.exe",
    });
  });
});
