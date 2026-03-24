import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Target {
  platform: "darwin" | "win32";
  arch: "arm64" | "x64";
  archiveName: string;
  binName: "bun" | "bun.exe";
}

const TARGETS: Target[] = [
  {
    platform: "darwin",
    arch: "arm64",
    archiveName: "bun-darwin-aarch64.zip",
    binName: "bun",
  },
  {
    platform: "darwin",
    arch: "x64",
    archiveName: "bun-darwin-x64.zip",
    binName: "bun",
  },
  {
    platform: "win32",
    arch: "x64",
    archiveName: "bun-windows-x64.zip",
    binName: "bun.exe",
  },
];

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, "..");

function getBunVersion(): string {
  const packageJsonPath = join(ROOT_DIR, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    packageManager?: string;
  };
  const match = packageJson.packageManager?.match(/bun@(\d+\.\d+\.\d+)/);

  if (!match) {
    throw new Error("Cannot determine Bun version from package.json packageManager field");
  }

  return match[1];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const allArch = args.includes("--all-arch");
  const platformIndex = args.indexOf("--platform");
  const targetPlatform = platformIndex >= 0 ? args[platformIndex + 1] : process.platform;

  return { all, allArch, targetPlatform };
}

function selectTargets(): Target[] {
  const { all, allArch, targetPlatform } = parseArgs();

  if (all) {
    return TARGETS;
  }

  let selectedTargets = TARGETS.filter(
    (target) =>
      target.platform === targetPlatform &&
      (allArch || target.arch === process.arch)
  );

  if (selectedTargets.length === 0) {
    selectedTargets = TARGETS.filter((target) => target.platform === targetPlatform);
  }

  if (selectedTargets.length === 0) {
    const available = TARGETS.map((target) => `${target.platform}-${target.arch}`).join(", ");
    throw new Error(
      `No target found for platform=${targetPlatform} arch=${process.arch}. Available: ${available}`
    );
  }

  return selectedTargets;
}

function extractZip(zipPath: string, outDir: string) {
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "pipe" }
    );
    return;
  }

  execFileSync("unzip", ["-o", zipPath, "-d", outDir], { stdio: "pipe" });
}

async function downloadAndExtract(target: Target, version: string) {
  const platformArch = `${target.platform}-${target.arch}`;
  const outDir = join(ROOT_DIR, "vendor", "bun", platformArch);
  const binPath = join(outDir, target.binName);

  if (existsSync(binPath)) {
    console.log(`✓ Already exists: ${platformArch}`);
    return;
  }

  mkdirSync(outDir, { recursive: true });

  const archive = target.archiveName;
  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${archive}`;
  const tmpZip = join(outDir, archive);

  console.log(`↓ Downloading Bun v${version} for ${platformArch}...`);
  console.log(`  ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "ZoraAgent-BunVendor/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} — ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(tmpZip, buffer);

  console.log("  Extracting...");
  try {
    extractZip(tmpZip, outDir);
  } catch (error) {
    throw new Error(
      `Extraction failed for ${platformArch}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const innerDirName = archive.replace(/\.zip$/, "");
  const innerBinPath = join(outDir, innerDirName, target.binName);

  if (existsSync(innerBinPath) && !existsSync(binPath)) {
    renameSync(innerBinPath, binPath);
  }

  const innerDir = join(outDir, innerDirName);
  if (existsSync(innerDir)) {
    rmSync(innerDir, { recursive: true, force: true });
  }

  if (existsSync(tmpZip)) {
    rmSync(tmpZip, { force: true });
  }

  if (!existsSync(binPath)) {
    throw new Error(`Bun binary not found after extraction: ${binPath}`);
  }

  if (target.platform !== "win32") {
    chmodSync(binPath, 0o755);
  }

  console.log(`✓ Installed: ${binPath}`);
}

async function main() {
  const version = getBunVersion();
  console.log(`Bun version from package.json: v${version}\n`);

  for (const target of selectTargets()) {
    await downloadAndExtract(target, version);
  }

  console.log("\nDone!");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
