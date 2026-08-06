import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  authorizePiTools,
  createPiTools,
} from "@/main/runtime/pi-tools";

describe("createPiTools", () => {
  it("provides all six file tools expected by Zora", async () => {
    const tools = await createPiTools(process.cwd());

    expect(tools.map((tool) => tool.name)).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "glob",
    ]);
  });

  it("executes a tool only after the permission gateway allows it", async () => {
    const execute = vi.fn(async () => ({ content: [], details: undefined }));
    const authorize = vi.fn(async () => ({
      behavior: "allow" as const,
      updatedInput: { path: "allowed.txt" },
    }));
    const tool = {
      name: "write",
      label: "Write",
      description: "write",
      parameters: {},
      execute,
    } as unknown as AgentTool<any>;
    const [wrapped] = authorizePiTools([tool], authorize);

    await wrapped.execute(
      "tool-1",
      { path: "requested.txt" },
      new AbortController().signal
    );

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: "tool-1",
      toolName: "write",
      input: { path: "requested.txt" },
    }));
    expect(execute).toHaveBeenCalledWith(
      "tool-1",
      { path: "allowed.txt" },
      expect.any(AbortSignal),
      undefined
    );
  });

  it("does not execute a tool when permission is denied", async () => {
    const execute = vi.fn();
    const tool = {
      name: "bash",
      label: "Bash",
      description: "bash",
      parameters: {},
      execute,
    } as unknown as AgentTool<any>;
    const [wrapped] = authorizePiTools([tool], async () => ({
      behavior: "deny",
      message: "blocked",
    }));

    await expect(wrapped.execute("tool-2", { command: "rm file" })).rejects.toThrow(
      "blocked"
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
