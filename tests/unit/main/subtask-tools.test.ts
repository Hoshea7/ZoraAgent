import { z } from "zod";
import {
  DEFAULT_DELEGATION_WAIT_TIMEOUT_SECONDS,
  MAX_DELEGATION_WAIT_TIMEOUT_SECONDS,
  type ScopedDelegationCoordinator,
} from "@/main/delegation/coordinator";
import { createSubtaskProvisionedTools } from "@/main/delegation/subtask-tools";

function createTools() {
  return createSubtaskProvisionedTools({} as ScopedDelegationCoordinator, {
    runtime: "pi",
    providerId: "408c7310-bccd-4cab-9dfd-899570f11569",
    modelId: "glm-5.2",
  });
}

describe("subtask tool interface", () => {
  it("requires an exact Provider UUID when a delegation target is specified", () => {
    const delegate = createTools().find((tool) => tool.toolName === "delegate_agent");
    expect(delegate).toBeDefined();
    const schema = z.object(delegate!.inputSchema);

    expect(
      schema.safeParse({
        task: "Inspect the repository",
        role: "explore",
        providerId: "火山agent",
        modelId: "glm-5.2",
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        task: "Inspect the repository",
        role: "explore",
        providerId: "408c7310-bccd-4cab-9dfd-899570f11569",
        modelId: "glm-5.2",
      }).success
    ).toBe(true);
  });

  it("auto-allows orchestration tools and keeps delegation responses gated", () => {
    const policies = Object.fromEntries(
      createTools().map((tool) => [tool.toolName, tool.approvalPolicy])
    );

    expect(policies).toEqual({
      list_available_models: "auto",
      delegate_agents: "auto",
      delegate_agent: "auto",
      wait_for_delegations: "auto",
      list_delegations: "auto",
      get_delegation_results: "auto",
      respond_to_delegation: "ask",
      continue_delegation: "auto",
      stop_delegation: "auto",
    });
  });

  it("defaults delegation waits to five minutes and allows up to ten minutes", () => {
    const wait = createTools().find((tool) => tool.toolName === "wait_for_delegations");
    expect(wait).toBeDefined();
    const schema = z.object(wait!.inputSchema);
    const delegationId = "408c7310-bccd-4cab-9dfd-899570f11569";

    expect(DEFAULT_DELEGATION_WAIT_TIMEOUT_SECONDS).toBe(300);
    expect(MAX_DELEGATION_WAIT_TIMEOUT_SECONDS).toBe(600);
    expect(
      schema.safeParse({ delegationIds: [delegationId], timeoutSeconds: 600 }).success
    ).toBe(true);
    expect(
      schema.safeParse({ delegationIds: [delegationId], timeoutSeconds: 601 }).success
    ).toBe(false);
  });
});
