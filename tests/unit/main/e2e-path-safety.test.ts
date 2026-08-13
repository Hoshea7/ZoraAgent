import path from "node:path";
import { assertE2EWritePath } from "../../e2e/support/e2e-path-safety";

describe("E2E path safety", () => {
  const runDirectory = path.resolve(
    "tests/.artifacts/e2e/runs/1234567890-0-test"
  );

  it("allows writes inside the current E2E run directory", () => {
    expect(() =>
      assertE2EWritePath(
        runDirectory,
        path.join(runDirectory, "home", ".zora", "workspaces.json")
      )
    ).not.toThrow();
  });

  it("rejects writes to the real Zora home", () => {
    expect(() =>
      assertE2EWritePath(
        runDirectory,
        path.join(process.env.HOME ?? "/Users/test", ".zora", "workspaces.json")
      )
    ).toThrow(/E2E 写入路径超出本次运行目录/);
  });

  it("rejects path traversal outside the current E2E run directory", () => {
    expect(() =>
      assertE2EWritePath(runDirectory, path.join(runDirectory, "..", "outside"))
    ).toThrow(/E2E 写入路径超出本次运行目录/);
  });
});
