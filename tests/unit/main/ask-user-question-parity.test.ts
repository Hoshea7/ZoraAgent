import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentStreamEvent } from "@/shared/zora";
import { answerAskUserQuestion } from "@/main/hitl";
import { ProductToolGate } from "@/main/hitl/tool-gate";
import { adaptToolGateToClaudeCanUseTool } from "@/main/runtime/claude-tool-gate";
import { adaptToolGateToPiTools } from "@/main/runtime/pi-tool-gate";
import { createPiAskUserQuestionTool } from "@/main/runtime/pi-ask-user-tool";

type RuntimeName = "claude" | "pi";

function getQuestionRequestId(events: AgentStreamEvent[]): string {
  const event = events.find((candidate) => candidate.type === "ask_user_request");
  if (!event || event.type !== "ask_user_request") {
    throw new Error("Expected an AskUserQuestion request event.");
  }
  return event.request.requestId;
}

describe.each<RuntimeName>(["claude", "pi"])(
  "%s AskUserQuestion adapter",
  (runtimeName) => {
    it("uses the shared gate and returns answers without a permission request", async () => {
      const events: AgentStreamEvent[] = [];
      const gate = new ProductToolGate(
        (event) => events.push(event),
        `ask-parity-${runtimeName}`,
        new Set()
      );
      const ask = vi.spyOn(gate, "ask");
      const signal = new AbortController().signal;
      const input = {
        question: "选择 Runtime",
        options: [{ label: "Pi", description: "Pi runtime" }],
      };

      const resultPromise = runtimeName === "claude"
        ? adaptToolGateToClaudeCanUseTool(gate)("AskUserQuestion", input, {
            signal,
            toolUseID: "claude-call",
          })
        : adaptToolGateToPiTools(
            [createPiAskUserQuestionTool(gate) as ToolDefinition],
            gate
          )[0].execute("pi-call", input, signal);

      await vi.waitFor(() => {
        expect(events.some((event) => event.type === "ask_user_request")).toBe(true);
      });
      expect(events.some((event) => event.type === "permission_request")).toBe(false);
      expect(ask).toHaveBeenCalledWith(
        expect.objectContaining({
          questions: [{
            question: "选择 Runtime",
            options: [{ label: "Pi", description: "Pi runtime" }],
          }],
        })
      );

      answerAskUserQuestion(getQuestionRequestId(events), { "0": "Pi" });

      if (runtimeName === "claude") {
        await expect(resultPromise).resolves.toEqual({
          behavior: "allow",
          updatedInput: { ...input, answers: { "0": "Pi" } },
        });
      } else {
        await expect(resultPromise).resolves.toMatchObject({
          details: { requestId: "pi-call", answers: { "0": "Pi" } },
          content: [{ type: "text", text: '{"0":"Pi"}' }],
        });
      }
    });
  }
);
