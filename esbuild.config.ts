import { build, context, type BuildOptions } from "esbuild";

const isWatch = process.argv.includes("--watch");

const shared: BuildOptions = {
  bundle: true,
  format: "cjs",
  platform: "node",
  packages: "external",
  target: "node20",
  sourcemap: true,
  external: ["electron", "@anthropic-ai/claude-agent-sdk"],
  tsconfig: "tsconfig.json"
};

const builds: BuildOptions[] = [
  {
    ...shared,
    entryPoints: ["src/main/index.ts"],
    outfile: "dist/main/index.js"
  },
  {
    ...shared,
    entryPoints: ["src/preload/index.ts"],
    outfile: "dist/main/preload.js"
  },
  {
    ...shared,
    entryPoints: ["src/main/document/document-worker.ts"],
    outfile: "dist/main/document-worker.js"
  }
];

async function run() {
  if (isWatch) {
    const contexts = await Promise.all(builds.map((options) => context(options)));
    await Promise.all(contexts.map((item) => item.watch()));
    console.log("[esbuild] watching main, preload, and document worker");
    return;
  }

  await Promise.all(builds.map((options) => build(options)));
  console.log("[esbuild] built main, preload, and document worker");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
