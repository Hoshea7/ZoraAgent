import {
  calculatePiCompactionReserveTokens,
  calculatePiCompactionThresholdTokens,
} from "@/main/runtime/pi-compaction";

describe("Pi automatic compaction", () => {
  it("starts compaction at 80% of a 200k context window", () => {
    expect(calculatePiCompactionReserveTokens(200_000)).toBe(40_000);
    expect(calculatePiCompactionThresholdTokens(200_000)).toBe(160_000);
  });

  it("rounds the reserved 20% up so the threshold never exceeds 80%", () => {
    expect(calculatePiCompactionReserveTokens(128_001)).toBe(25_601);
    expect(calculatePiCompactionThresholdTokens(128_001)).toBe(102_400);
  });

  it("keeps the threshold independent from the model output budget", () => {
    expect(calculatePiCompactionReserveTokens(200_000)).toBe(40_000);
    expect(calculatePiCompactionThresholdTokens(200_000)).toBe(160_000);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid context window: %s",
    (contextWindow) => {
      expect(() =>
        calculatePiCompactionReserveTokens(contextWindow)
      ).toThrow(
        "Pi context window must be a positive finite number"
      );
    }
  );
});
