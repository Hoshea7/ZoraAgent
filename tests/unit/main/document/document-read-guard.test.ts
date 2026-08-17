import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createClaudeDocumentReadGuardHook,
  wrapPiDocumentReadGuard,
} from "@/main/document/document-read-guard";
import { createPdfFixture } from "../../../helpers/document-fixtures";

function context(workingDirectory: string) {
  return {
    workspaceId: "workspace-1",
    sessionId: "session-1",
    runtime: "pi" as const,
    mainModel: { providerId: "provider-1", modelId: "model-1" },
    runOrigin: "desktop" as const,
    workingDirectory,
    vision: { imageInputCapability: "unknown" as const, visionRelayEnabled: false },
  };
}

describe("document Read guards", () => {
  it("blocks Claude Read for a document identified by bytes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zora-doc-guard-"));
    await writeFile(path.join(directory, "report.pdf"), createPdfFixture());
    try {
      const hook = createClaudeDocumentReadGuardHook(context(directory));
      const result = await hook({
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "report.pdf" },
      } as never, undefined, { signal: new AbortController().signal });
      expect(result).toMatchObject({
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: expect.stringContaining("read_document"),
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("blocks Pi Read and preserves ordinary text Read", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "zora-doc-guard-"));
    await writeFile(path.join(directory, "report.pdf"), createPdfFixture());
    await writeFile(path.join(directory, "notes.txt"), "hello");
    const execute = vi.fn(async () => ({ content: [{ type: "text", text: "native" }] }));
    const wrapped = wrapPiDocumentReadGuard({ name: "read", execute } as never, context(directory));
    try {
      const blocked = await wrapped.execute("call-1", { path: "report.pdf" }, undefined, undefined, {} as never);
      expect(blocked).toMatchObject({ isError: true, details: { blockedBy: "document-read-guard" } });
      expect(execute).not.toHaveBeenCalled();
      await wrapped.execute("call-2", { path: "notes.txt" }, undefined, undefined, {} as never);
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
