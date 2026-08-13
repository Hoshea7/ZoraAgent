import {
  calculatePiCompactionReserveTokens,
  calculatePiCompactionThresholdTokens,
} from "@/main/runtime/pi-compaction";

describe("Pi automatic compaction", () => {
  it("starts compaction at 80% of a 200k context window", () => {
    expect(calculatePiCompactionReserveTokens(200_000, 16_384)).toBe(40_000);
    expect(calculatePiCompactionThresholdTokens(200_000, 16_384)).toBe(160_000);
  });

  it("rounds the reserved 20% up so the threshold never exceeds 80%", () => {
    expect(calculatePiCompactionReserveTokens(128_001, 16_384)).toBe(25_601);
    expect(calculatePiCompactionThresholdTokens(128_001, 16_384)).toBe(102_400);
  });

  it("reserves the full output budget when it exceeds 20% of context", () => {
    expect(calculatePiCompactionReserveTokens(27_000, 16_384)).toBe(16_384);
    expect(calculatePiCompactionThresholdTokens(27_000, 16_384)).toBe(10_616);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid context window: %s",
    (contextWindow) => {
      expect(() =>
        calculatePiCompactionReserveTokens(contextWindow, 16_384)
      ).toThrow(
        "Pi context window must be a positive finite number"
      );
    }
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid output budget: %s",
    (maxOutputTokens) => {
      expect(() =>
        calculatePiCompactionReserveTokens(200_000, maxOutputTokens)
      ).toThrow("Pi max output tokens must be a positive finite number");
    }
  );
});
