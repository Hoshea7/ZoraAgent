import path from "node:path";
import {
  getPiSessionRuntimeDir,
  getSessionRuntimeRoot,
} from "@/main/session-artifacts";

describe("session artifact paths", () => {
  it("nests Pi checkpoints below the owning product session", () => {
    expect(getSessionRuntimeRoot("workspace-1")).toBe(
      path.join(
        process.env.ZORA_HOME ?? path.join(process.env.HOME ?? "", ".zora"),
        "workspaces",
        "workspace-1",
        "sessions",
        "runtime"
      )
    );
    expect(getPiSessionRuntimeDir("workspace-1", "session-1")).toBe(
      path.join(getSessionRuntimeRoot("workspace-1"), "pi", "session-1")
    );
  });
});
