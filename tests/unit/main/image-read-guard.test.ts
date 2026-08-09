import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  createClaudeImageReadGuardHook,
  wrapPiReadTool,
} from "@/main/vision/image-read-guard";

describe("image Read guard", () => {
  it("blocks an image by magic bytes even without an image extension", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-read-guard-"));
    const filePath = path.join(root, "asset.bin");
    await writeFile(filePath, await sharp({
      create: { width: 1, height: 1, channels: 3, background: "black" },
    }).png().toBuffer());
    const hook = createClaudeImageReadGuardHook("unsupported");

    const result = await hook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: filePath },
    } as never, undefined, { signal: new AbortController().signal });

    expect(result).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("Inspect Image"),
      },
    });
  });

  it("preserves Pi Read behavior for supported image models", async () => {
    const execute = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const tool = { name: "read", execute } as never;
    const wrapped = wrapPiReadTool(tool, "supported");

    await wrapped.execute("call-1", { path: "/missing.png" }, undefined, undefined, {} as never);

    expect(execute).toHaveBeenCalledOnce();
  });
});
