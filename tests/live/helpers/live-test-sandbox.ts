import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const SANDBOXES_ROOT = path.resolve(
  __dirname,
  "../../.artifacts/live/sandboxes",
);

export interface LiveTestSandbox {
  rootDir: string;
  homeDir: string;
  zoraHomeDir: string;
  workspaceDir: string;
  tmpDir: string;
  environment: Record<string, string>;
  cleanup: () => Promise<void>;
}

export async function createLiveTestSandbox(): Promise<LiveTestSandbox> {
  await mkdir(SANDBOXES_ROOT, { recursive: true });
  const rootDir = await mkdtemp(path.join(SANDBOXES_ROOT, "query-"));
  const homeDir = path.join(rootDir, "home");
  const zoraHomeDir = path.join(homeDir, ".zora");
  const workspaceDir = path.join(rootDir, "workspace");
  const tmpDir = path.join(rootDir, "tmp");
  const xdgConfigDir = path.join(rootDir, "xdg", "config");
  const xdgCacheDir = path.join(rootDir, "xdg", "cache");
  const xdgStateDir = path.join(rootDir, "xdg", "state");

  await Promise.all([
    mkdir(zoraHomeDir, { recursive: true }),
    mkdir(workspaceDir, { recursive: true }),
    mkdir(tmpDir, { recursive: true }),
    mkdir(xdgConfigDir, { recursive: true }),
    mkdir(xdgCacheDir, { recursive: true }),
    mkdir(xdgStateDir, { recursive: true }),
  ]);

  return {
    rootDir,
    homeDir,
    zoraHomeDir,
    workspaceDir,
    tmpDir,
    environment: {
      HOME: homeDir,
      USERPROFILE: homeDir,
      ZORA_HOME: zoraHomeDir,
      TMPDIR: tmpDir,
      XDG_CONFIG_HOME: xdgConfigDir,
      XDG_CACHE_HOME: xdgCacheDir,
      XDG_STATE_HOME: xdgStateDir,
    },
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
  };
}
