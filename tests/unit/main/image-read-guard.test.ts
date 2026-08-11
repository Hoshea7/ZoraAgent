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
  it("preserves Claude Read when relay is disabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-read-guard-"));
    const filePath = path.join(root, "asset.bin");
    await writeFile(filePath, await sharp({
      create: { width: 1, height: 1, channels: 3, background: "black" },
    }).png().toBuffer());
    const hook = createClaudeImageReadGuardHook("unsupported", {
      workspaceId: "workspace-1",
      sessionId: "session-1",
      runtime: "claude",
      mainModel: { providerId: "provider-1", modelId: "model-1" },
      runOrigin: "desktop",
      imageInputCapability: "unsupported",
      visionRelayEnabled: false,
    });

    const result = await hook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: filePath },
    } as never, undefined, { signal: new AbortController().signal });

    expect(result).toEqual({ continue: true });
  });

  it("blocks an image by magic bytes when relay is enabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-read-guard-"));
    const filePath = path.join(root, "asset.bin");
    await writeFile(filePath, await sharp({
      create: { width: 1, height: 1, channels: 3, background: "black" },
    }).png().toBuffer());
    const hook = createClaudeImageReadGuardHook("unsupported", {
      workspaceId: "workspace-1",
      sessionId: "session-1",
      runtime: "claude",
      mainModel: { providerId: "provider-1", modelId: "model-1" },
      runOrigin: "desktop",
      imageInputCapability: "unsupported",
      visionRelayEnabled: true,
    });

    const result = await hook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: filePath },
    } as never, undefined, { signal: new AbortController().signal });

    expect(result).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
      },
    });
  });

  it("guides a registered session image to Inspect Image only when relay is enabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zora-read-guard-"));
    const filePath = path.join(root, "asset.bin");
    await writeFile(filePath, await sharp({
      create: { width: 1, height: 1, channels: 3, background: "black" },
    }).png().toBuffer());
    const execute = vi.fn();
    const wrapped = wrapPiReadTool({ name: "read", execute } as never, "unknown", {
      workspaceId: "workspace-1",
      sessionId: "session-1",
      runtime: "pi",
      mainModel: { providerId: "provider-1", modelId: "model-1" },
      runOrigin: "desktop",
      imageInputCapability: "unknown",
      visionRelayEnabled: true,
    });

    const result = await wrapped.execute(
      "call-1",
      { path: filePath },
      undefined,
      undefined,
      {} as never
    );

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Inspect Image"),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves Pi Read behavior for supported image models", async () => {
    const execute = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const tool = { name: "read", execute } as never;
    const wrapped = wrapPiReadTool(tool, "supported");

    await wrapped.execute("call-1", { path: "/missing.png" }, undefined, undefined, {} as never);

    expect(execute).toHaveBeenCalledOnce();
  });
});
