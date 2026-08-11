import {
  appendDynamicSystemContext,
  composeHarnessPrompt,
} from "@/main/agent-profiles";
import type { AgentRequest } from "@/main/agent-profiles";

const harness: AgentRequest = {
  profileId: "productivity",
  sessionId: "session-1",
  workspaceId: "workspace-1",
  prompt: {
    user: "current user request",
    dynamicContext: "dynamic memory context",
    system: "static system context",
  },
  conversation: { messages: [], persistence: "durable" },
  workspace: { cwd: "/tmp/project" },
  permissions: { mode: "interactive" },
  model: { maxOutputTokens: 16_384, reasoningLevel: "high" },
  budget: { maxTurns: 120 },
  output: { incremental: true, visible: true },
};

describe("agent prompt placement", () => {
  it("keeps the user prompt free of dynamic system context", () => {
    expect(composeHarnessPrompt(harness)).toBe("current user request");
    expect(composeHarnessPrompt(harness, "recovered conversation")).toBe(
      "recovered conversation"
    );
  });

  it("places dynamic context at the end of the assembled system prompt", () => {
    expect(
      appendDynamicSystemContext(
        "static system\n\nskills\n\ncurrent working directory",
        "dynamic memory context"
      )
    ).toBe(
      "static system\n\nskills\n\ncurrent working directory\n\ndynamic memory context"
    );
  });
});
