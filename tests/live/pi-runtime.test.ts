import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PiRuntimeAdapter } from "@main/runtime/pi-adapter";
import type { ProviderConfig, ProviderType } from "@shared/types/provider";
import { resolveProviderProtocol } from "@shared/provider-protocol";
import { describeLive } from "./helpers/skip-guard";

describeLive("Pi Runtime", (provider) => {
  it("reads package.json through the Pi coding tools", async () => {
    let piProvider = provider;
    try {
      const configured = JSON.parse(
        readFileSync(path.join(homedir(), ".zora", "providers.json"), "utf8")
      ) as ProviderConfig[];
      const configuredProvider = configured.find(
        (item) =>
          item.enabled &&
          item.baseUrl.includes("/compatible") &&
          item.apiKey &&
          item.modelId
      ) ?? configured.find(
        (item) =>
          item.enabled &&
          item.providerType === "custom" &&
          item.baseUrl.startsWith("http://localhost") &&
          item.apiKey &&
          item.modelId
      );
      if (configuredProvider) {
        piProvider = {
          apiKey: configuredProvider.apiKey,
          baseUrl: configuredProvider.baseUrl,
          model: configuredProvider.modelId,
          name: configuredProvider.name,
          providerType: configuredProvider.providerType,
          protocol: resolveProviderProtocol(configuredProvider),
        };
      }
    } catch {
      // CI uses the provider supplied by ZORA_TEST_PROVIDER_CONFIG.
    }

    const providerConfig: ProviderConfig = {
      id: "pi-live-provider",
      name: piProvider.name,
      providerType: piProvider.providerType as ProviderType,
      baseUrl: piProvider.baseUrl,
      apiKey: piProvider.apiKey,
      modelId: piProvider.model,
      enabled: true,
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const events: Array<Record<string, unknown>> = [];
    const adapter = new PiRuntimeAdapter();

    try {
      const run = adapter.start({
        harness: {
          profileId: "productivity",
          sessionId: "pi-live-session",
          workspaceId: "live",
          prompt: {
            user: "Call the read tool to read package.json, then reply with only the package name.",
            dynamicContext: "",
            system: "You are a coding assistant. Use the provided tools when requested.",
          },
          conversation: { messages: [], persistence: "ephemeral" },
          workspace: { cwd: process.cwd() },
          permissions: { mode: "unattended" },
          limits: { maxTurns: 4, maxOutputTokens: 16_384, reasoningEffort: "medium" },
          output: { incremental: true, visible: true },
        },
        forwardEvent: (event) => events.push(event as Record<string, unknown>),
        target: {
          runtimeType: "pi",
          provider: { ...providerConfig, apiKey: piProvider.apiKey },
          protocol: piProvider.protocol ?? "anthropic-messages",
          modelId: piProvider.model ?? "",
        },
        source: "desktop",
      });
      await run.completion;
    } finally {
      adapter.dispose();
    }

    const usedRead = events.some((event) => {
      if (event.type !== "stream_event") {
        return false;
      }
      const sdkEvent = event.event as Record<string, unknown> | undefined;
      const block = sdkEvent?.content_block as Record<string, unknown> | undefined;
      return block?.type === "tool_use" && block.name === "Read";
    });
    const hasAssistant = events.some((event) => event.type === "assistant");
    const diagnostics = events.map((event) => ({
      type: event.type,
      error: typeof event.error === "string" ? event.error : undefined,
      innerType:
        event.event && typeof event.event === "object"
          ? (event.event as Record<string, unknown>).type
          : undefined,
    }));

    expect(usedRead, JSON.stringify(diagnostics)).toBe(true);
    expect(hasAssistant).toBe(true);
  });
});
