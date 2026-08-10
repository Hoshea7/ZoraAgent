import { describe, expect, it } from "vitest";
import {
  createRuntimeProjectionFingerprint,
  hasRuntimeProjectionChanged,
} from "@/main/runtime/runtime-projection";

describe("runtime projection fingerprint", () => {
  const fingerprint = createRuntimeProjectionFingerprint({
    runtime: "pi",
    providerId: "provider-1",
    modelId: "model-1",
    imageInputCapability: "unsupported",
  });

  it("keeps a derived session only while every projection field matches", () => {
    expect(hasRuntimeProjectionChanged(fingerprint, { ...fingerprint })).toBe(false);
  });

  it.each([
    { runtime: "claude" as const },
    { providerId: "provider-2" },
    { modelId: "model-2" },
    { imageInputCapability: "supported" as const },
  ])("invalidates derived sessions after $runtime$providerId$modelId$imageInputCapability changes", (patch) => {
    expect(hasRuntimeProjectionChanged(fingerprint, { ...fingerprint, ...patch })).toBe(true);
  });
});
