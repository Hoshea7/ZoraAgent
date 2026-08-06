import { createTurnGuard } from "@/main/runtime/pi-runtime-guard";

describe("createTurnGuard", () => {
  it("stops at the configured turn limit and can be reset", () => {
    const guard = createTurnGuard(2);

    expect(guard.shouldStopAfterTurn()).toBe(false);
    expect(guard.shouldStopAfterTurn()).toBe(true);

    guard.reset();
    expect(guard.shouldStopAfterTurn()).toBe(false);
  });

  it("uses one turn when the configured value is invalid", () => {
    expect(createTurnGuard(0).shouldStopAfterTurn()).toBe(true);
  });
});
