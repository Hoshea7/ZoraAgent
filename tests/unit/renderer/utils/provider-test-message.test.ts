import { formatProviderTestError } from "@/renderer/utils/provider-test-message";

describe("formatProviderTestError", () => {
  it("summarizes exhausted weekly quota", () => {
    expect(
      formatProviderTestError(
        '429: {"code":"AccountQuotaExceeded","message":"You have exceeded the weekly usage quota. Request id: req-1"}'
      )
    ).toBe("本周额度已用完，请等待额度重置。");
  });

  it("extracts the provider message and removes request ids", () => {
    expect(
      formatProviderTestError(
        '400: {"code":"InvalidParameter","message":"Unsupported role. Request id: req-2"}'
      )
    ).toBe("Unsupported role.");
  });

  it("preserves a short plain-text error", () => {
    expect(formatProviderTestError("模型不存在")).toBe("模型不存在");
  });
});
