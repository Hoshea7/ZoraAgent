import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { adaptToolGateToClaudeCanUseTool } from "@/main/runtime/claude-tool-gate";
import { adaptToolGateToPiTools } from "@/main/runtime/pi-tool-gate";
import type { ToolGate } from "@/main/runtime/tool-gate";

type EngineName = "claude" | "pi";
type ExecuteTool = (
  tool: string,
  input: Record<string, unknown>,
  execute: (input: Record<string, unknown>) => Promise<unknown>,
  unattended?: boolean
) => Promise<unknown>;

function createEngine(name: EngineName, gate: ToolGate): ExecuteTool {
  if (name === "claude") {
    const authorize = adaptToolGateToClaudeCanUseTool(gate);
    return async (tool, input, execute, unattended = false) => {
      if (unattended) return execute(input);
      const decision = await authorize(tool, input, {
        signal: new AbortController().signal,
        toolUseID: `call-${tool}`,
      });
      if (decision.behavior === "deny") {
        throw new Error(decision.message);
      }
      return execute(decision.updatedInput);
    };
  }

  return async (tool, input, execute, unattended = false) => {
    if (unattended) return execute(input);
    const piName = tool.toLowerCase();
    const definition = {
      name: piName,
      execute: async (_callId: string, params: Record<string, unknown>) =>
        execute(params),
    } as unknown as ToolDefinition;
    const [authorized] = adaptToolGateToPiTools([definition], gate);
    return authorized.execute(
      `call-${tool}`,
      input,
      new AbortController().signal,
      undefined,
      {} as never
    );
  };
}

describe.each<EngineName>(["claude", "pi"])(
  "%s ToolGate adapter",
  (engineName) => {
    it.each([
      ["Write", { path: "requested.txt", content: "hello" }],
      ["Edit", { path: "requested.txt", edits: [] }],
      ["Bash", { command: "echo hello" }],
    ] as const)("authorizes canonical %s before execution", async (tool, input) => {
      const authorize = vi.fn(async () => ({ behavior: "allow" as const }));
      const execute = vi.fn(async () => "done");
      const run = createEngine(engineName, { authorize });

      await expect(run(tool, input, execute)).resolves.toBe("done");

      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({ tool, callId: `call-${tool}` })
      );
      expect(execute).toHaveBeenCalledOnce();
    });

    it("does not execute denied tools and returns the reason", async () => {
      const gate: ToolGate = {
        authorize: vi.fn(async () => ({
          behavior: "deny",
          message: "blocked by policy",
        })),
      };
      const execute = vi.fn(async () => "done");
      const run = createEngine(engineName, gate);

      await expect(run("Write", { path: "blocked.txt" }, execute)).rejects.toThrow(
        "blocked by policy"
      );
      expect(execute).not.toHaveBeenCalled();
    });

    it("passes authorized input overrides to the tool", async () => {
      const approvedInput = { path: "approved.txt", content: "approved" };
      const gate: ToolGate = {
        authorize: vi.fn(async () => ({
          behavior: "allow",
          input: approvedInput,
        })),
      };
      const execute = vi.fn(async () => "done");
      const run = createEngine(engineName, gate);

      await run("Write", { path: "requested.txt" }, execute);

      expect(execute).toHaveBeenCalledWith(approvedInput);
    });

    it("does not call the gate in unattended mode", async () => {
      const authorize = vi.fn(async () => ({ behavior: "allow" as const }));
      const execute = vi.fn(async () => "done");
      const run = createEngine(engineName, { authorize });

      await run("Bash", { command: "echo hello" }, execute, true);

      expect(authorize).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledOnce();
    });
  }
);
