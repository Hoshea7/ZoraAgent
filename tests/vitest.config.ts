import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.resolve(__dirname, "../src");

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "main",
          globals: true,
          environment: "node",
          include: [
            "tests/unit/main/**/*.test.ts",
            "tests/unit/shared/**/*.test.ts",
          ],
          setupFiles: ["tests/helpers/setup-main.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "renderer",
          globals: true,
          environment: "happy-dom",
          include: ["tests/unit/renderer/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/helpers/setup-renderer.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          globals: true,
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/helpers/setup-main.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
