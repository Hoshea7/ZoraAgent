import { readFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PiAgentRuntimeAdapter } from "@main/runtime/pi-adapter";
import { McpManager, setSharedMcpManager } from "@main/mcp-manager";
import type { ProviderConfig, ProviderType } from "@shared/types/provider";
import { resolveProviderProtocol } from "@shared/provider-protocol";
import { describeLive } from "./helpers/skip-guard";
import { createToolProvisioningPlan } from "@main/runtime/tool-provisioning";
import { createUnattendedToolGate } from "@main/runtime/tool-gate";
import { migrateProviderConfigFile } from "@main/provider-config";
import { createLiveTestSandbox } from "./helpers/live-test-sandbox";

describeLive("Pi Runtime", (provider) => {
  it("reads package.json through the Pi coding tools", async () => {
    let piProvider = provider;
    try {
      const configured = migrateProviderConfigFile(JSON.parse(
        readFileSync(path.join(homedir(), ".zora", "providers.json"), "utf8")
      ) as unknown).file.providers;
      const configuredProvider = configured.find(
        (item) =>
          item.enabled &&
          item.baseUrl.includes("/compatible") &&
          item.apiKey &&
          item.models.some((model) => model.enabled)
      ) ?? configured.find(
        (item) =>
          item.enabled &&
          item.providerType === "custom" &&
          item.baseUrl.startsWith("http://localhost") &&
          item.apiKey &&
          item.models.some((model) => model.enabled)
      );
      if (configuredProvider) {
        const configuredModel = configuredProvider.models.find((model) => model.enabled)!;
        piProvider = {
          apiKey: configuredProvider.apiKey,
          baseUrl: configuredProvider.baseUrl,
          model: configuredModel.id,
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
      models: [
        {
          id: piProvider.model ?? "",
          enabled: true,
          contextWindow: 200_000,
        },
      ],
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const events: Array<Record<string, unknown>> = [];
    const sandbox = await createLiveTestSandbox();
    await copyFile(
      path.join(process.cwd(), "package.json"),
      path.join(sandbox.workspaceDir, "package.json")
    );
    setSharedMcpManager(new McpManager());
    const adapter = new PiAgentRuntimeAdapter();
    const toolProvisioningPlan = createToolProvisioningPlan({ servers: {} });

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
          workspace: { cwd: sandbox.workspaceDir },
          permissions: { mode: "unattended" },
          model: { maxOutputTokens: 16_384, reasoningLevel: "high" },
          budget: { maxTurns: 4 },
          output: { incremental: true, visible: true },
        },
        forwardEvent: (event) => events.push(event as Record<string, unknown>),
        target: {
          agentRuntimeType: "pi",
          provider: { ...providerConfig, apiKey: piProvider.apiKey },
          protocol: piProvider.protocol ?? "anthropic-messages",
          modelId: piProvider.model ?? "",
          contextWindow: 200_000,
        },
        source: "desktop",
        vision: {
          imageInputCapability: "unknown",
          visionRelayEnabled: false,
        },
        toolGate: createUnattendedToolGate(),
        toolProvisioningPlan,
        toolProvisioningRequest: {
          sessionId: "pi-live-session",
          workspaceId: "live",
          runtime: "pi",
          source: "desktop",
        },
      });
      await run.completion;
    } finally {
      adapter.dispose();
      await sandbox.cleanup();
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
