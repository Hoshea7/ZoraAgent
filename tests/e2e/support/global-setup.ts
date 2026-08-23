import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const RUNS_ROOT = path.join(REPO_ROOT, "tests", ".artifacts", "e2e", "runs");

export default async function resetE2ERuns(): Promise<void> {
  await rm(RUNS_ROOT, { recursive: true, force: true });
  await mkdir(RUNS_ROOT, { recursive: true });
}
