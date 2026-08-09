import type { AgentStreamEvent } from "@/shared/zora";
import {
  answerAskUserQuestion,
  clearAllPending,
  clearSessionWhitelist,
  getPermissionMode,
  respondToPermission,
  setPermissionMode,
} from "@/main/hitl";
import { ProductToolGate } from "@/main/hitl/tool-gate";

const sessionIds = [
  "gate-readonly",
  "gate-dangerous",
  "gate-ask",
  "gate-smart",
  "gate-yolo",
  "gate-session-a",
  "gate-session-b",
];

function request(tool: string, input: Record<string, unknown>) {
  return {
    tool,
    input,
    callId: `call-${tool}`,
    signal: new AbortController().signal,
  };
}

function permissionRequestId(events: AgentStreamEvent[]): string {
  const event = events.find((candidate) => candidate.type === "permission_request");
  if (!event || event.type !== "permission_request") {
    throw new Error("Expected a permission request event.");
  }
  return event.request.requestId;
}

afterEach(() => {
  clearAllPending();
  setPermissionMode("ask");
  for (const sessionId of sessionIds) {
    clearSessionWhitelist(sessionId);
  }
});

describe("ProductToolGate", () => {
  it("allows tools marked read-only by the run provisioning plan", async () => {
    const events: AgentStreamEvent[] = [];
    const gate = new ProductToolGate(
      (event) => events.push(event),
      "gate-plan-readonly",
      new Set(["mcp__subtask__wait_for_delegations"])
    );

    await expect(
      gate.authorize(
        request("mcp__subtask__wait_for_delegations", { delegationIds: ["id"] })
      )
    ).resolves.toEqual({ behavior: "allow" });
    expect(events).toEqual([]);
  });
  it("auto-allows read-only tools", async () => {
    const events: AgentStreamEvent[] = [];
    const gate = new ProductToolGate((event) => events.push(event), "gate-readonly", new Set());

    await expect(gate.authorize(request("Read", { file_path: "README.md" }))).resolves.toEqual({
      behavior: "allow",
    });
    expect(events).toEqual([]);
  });

  it("does not auto-allow dangerous Bash commands", async () => {
    const events: AgentStreamEvent[] = [];
    setPermissionMode("smart", "gate-dangerous");
    const gate = new ProductToolGate((event) => events.push(event), "gate-dangerous", new Set());

    const decision = gate.authorize(request("Bash", { command: "sudo rm -rf /" }));
    const requestId = permissionRequestId(events);
    respondToPermission(requestId, "deny", false, "危险命令");

    await expect(decision).resolves.toEqual({
      behavior: "deny",
      message: "用户拒绝了此操作：危险命令",
    });
  });

  it("keeps ask, smart and yolo behavior", async () => {
    const askEvents: AgentStreamEvent[] = [];
    setPermissionMode("ask", "gate-ask");
    const askGate = new ProductToolGate((event) => askEvents.push(event), "gate-ask", new Set());
    const askDecision = askGate.authorize(request("Write", { file_path: "ask.txt" }));
    respondToPermission(permissionRequestId(askEvents), "deny", false);
    await expect(askDecision).resolves.toMatchObject({ behavior: "deny" });

    setPermissionMode("smart", "gate-smart");
    const smartGate = new ProductToolGate(() => {}, "gate-smart", new Set());
    await expect(
      smartGate.authorize(request("Write", { file_path: "smart.txt" }))
    ).resolves.toEqual({ behavior: "allow" });

    setPermissionMode("yolo", "gate-yolo");
    const yoloGate = new ProductToolGate(() => {}, "gate-yolo", new Set());
    await expect(
      yoloGate.authorize(request("Bash", { command: "sudo rm -rf /" }))
    ).resolves.toEqual({ behavior: "allow" });
  });

  it("uses one ask pending registry for the canonical question flow", async () => {
    const events: AgentStreamEvent[] = [];
    const gate = new ProductToolGate((event) => events.push(event), "gate-ask", new Set());
    const signalController = new AbortController();
    await expect(
      gate.authorize(request("AskUserQuestion", { question: "权限卡不应出现" }))
    ).resolves.toEqual({ behavior: "allow" });
    expect(events).toEqual([]);

    const answersPromise = gate.ask({
      questions: [
        {
          question: "选择运行时",
          options: [{ label: "Pi" }, { label: "Claude" }],
        },
      ],
      callId: "ask-question-call",
      signal: signalController.signal,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "ask_user_request",
        request: expect.objectContaining({
          requestId: "ask-question-call",
          questions: [{
            question: "选择运行时",
            options: [{ label: "Pi" }, { label: "Claude" }],
          }],
        }),
      }),
    ]);
    expect(events.some((event) => event.type === "permission_request")).toBe(false);

    answerAskUserQuestion("ask-question-call", { "0": "Pi" });
    await expect(answersPromise).resolves.toEqual({ "0": "Pi" });
    expect(events.at(-1)).toEqual({
      type: "ask_user_resolved",
      requestId: "ask-question-call",
    });
  });

  it("rejects and clears an aborted question without leaving pending state", async () => {
    const events: AgentStreamEvent[] = [];
    const controller = new AbortController();
    const gate = new ProductToolGate((event) => events.push(event), "gate-ask", new Set());
    const answersPromise = gate.ask({
      questions: [{ question: "继续吗？" }],
      callId: "ask-abort-call",
      signal: controller.signal,
    });

    controller.abort();
    await expect(answersPromise).rejects.toThrow("操作已中止");

    const secondController = new AbortController();
    const clearedPromise = gate.ask({
      questions: [{ question: "清理测试" }],
      callId: "ask-clear-call",
      signal: secondController.signal,
    });
    clearAllPending();
    await expect(clearedPromise).rejects.toThrow("会话已结束");
  });

  it("isolates permission modes between concurrent sessions", async () => {
    const sessionAEvents: AgentStreamEvent[] = [];
    const sessionBEvents: AgentStreamEvent[] = [];
    setPermissionMode("smart", "gate-session-a");
    setPermissionMode("ask", "gate-session-b");
    const sessionA = new ProductToolGate(
      (event) => sessionAEvents.push(event),
      "gate-session-a",
      new Set()
    );
    const sessionB = new ProductToolGate(
      (event) => sessionBEvents.push(event),
      "gate-session-b",
      new Set()
    );

    const [decisionA, decisionBPromise] = [
      sessionA.authorize(request("Write", { file_path: "a.txt" })),
      sessionB.authorize(request("Write", { file_path: "b.txt" })),
    ];

    expect(getPermissionMode("gate-session-a")).toBe("smart");
    expect(getPermissionMode("gate-session-b")).toBe("ask");
    expect(sessionAEvents).toEqual([]);
    respondToPermission(permissionRequestId(sessionBEvents), "allow", false);

    await expect(decisionA).resolves.toEqual({ behavior: "allow" });
    await expect(decisionBPromise).resolves.toEqual({ behavior: "allow" });
  });
});
