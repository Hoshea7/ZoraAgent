import {
  PiSessionBridge,
  type PiSessionHandle,
} from "@/main/runtime/pi-session-bridge";
import type { PiProviderConfig } from "@/main/runtime/pi-provider-registry";
import type { HarnessLimits } from "@/main/agent-profiles";

const provider: PiProviderConfig = {
  api: "openai-completions",
  baseUrl: "https://example.com/v1",
  apiKey: "sk-test",
  model: "example-model",
  providerId: "provider-1",
};

const limits: HarnessLimits = {
  maxTurns: 120,
  maxOutputTokens: 16_384,
  reasoningEffort: "medium",
};

describe("PiSessionBridge", () => {
  it("reuses one Pi session per Zora session", async () => {
    const handle: PiSessionHandle = {
      replaceHistory: vi.fn(),
      run: vi.fn(),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    const factory = vi.fn(async () => handle);
    const bridge = new PiSessionBridge(factory);

    const first = await bridge.getOrCreateAgent("session-1", provider, "/tmp/project", limits);
    const second = await bridge.getOrCreateAgent("session-1", provider, "/tmp/project", limits);

    expect(first).toBe(handle);
    expect(second).toBe(handle);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("aborts and disposes a removed session", async () => {
    const handle: PiSessionHandle = {
      replaceHistory: vi.fn(),
      run: vi.fn(),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    const bridge = new PiSessionBridge(async () => handle);

    await bridge.getOrCreateAgent("session-1", provider, "/tmp/project", limits);
    bridge.disposeAgent("session-1");

    expect(handle.abort).toHaveBeenCalledOnce();
    expect(handle.dispose).toHaveBeenCalledOnce();
  });

  it("can retry after Pi session initialization fails", async () => {
    const handle: PiSessionHandle = {
      replaceHistory: vi.fn(),
      run: vi.fn(),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error("load failed"))
      .mockResolvedValueOnce(handle);
    const bridge = new PiSessionBridge(factory);

    await expect(
      bridge.getOrCreateAgent("session-1", provider, "/tmp/project", limits)
    ).rejects.toThrow("load failed");
    await expect(
      bridge.getOrCreateAgent("session-1", provider, "/tmp/project", limits)
    ).resolves.toBe(handle);

    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("creates a new session when limits change", async () => {
    const handle1: PiSessionHandle = {
      replaceHistory: vi.fn(),
      run: vi.fn(),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    const handle2: PiSessionHandle = {
      replaceHistory: vi.fn(),
      run: vi.fn(),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    let callCount = 0;
    const factory = vi.fn(async () => {
      callCount += 1;
      return callCount === 1 ? handle1 : handle2;
    });
    const bridge = new PiSessionBridge(factory);

    const first = await bridge.getOrCreateAgent("session-1", provider, "/tmp/project", limits);
    const highLimits: HarnessLimits = { ...limits, reasoningEffort: "high" };
    const second = await bridge.getOrCreateAgent("session-1", provider, "/tmp/project", highLimits);

    expect(first).toBe(handle1);
    expect(second).toBe(handle2);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(handle1.dispose).toHaveBeenCalledOnce();
  });
});
