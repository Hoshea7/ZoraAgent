import { z } from "zod";
import { createRuntimeModelCapabilityResolver } from "../model-capability-service";
import type {
  ImageInputCapability,
  ModelIdentity,
  ToolCallContext,
  VisionSettings,
} from "../../shared/types/vision";
import {
  attachmentResourceModule,
  type ResolvedAttachment,
} from "../attachment-resource";
import { providerManager } from "../provider-manager";
import {
  type ProvisionedToolResult,
} from "../runtime/tool-provisioning";
import {
  visionSettingsStore,
  type VisionSettingsStore,
} from "../vision-settings";
import { ImageNormalizer } from "./image-normalizer";
import { PiVisionProviderAdapter } from "./pi-vision-provider-adapter";
import { VisionRelayModule } from "./vision-relay";

export const VISION_SERVER_NAME = "zora_vision";
export const INSPECT_IMAGE_TOOL_NAME = "inspect_image";
export const INSPECT_IMAGE_CANONICAL_NAME = "mcp__zora_vision__inspect_image";

export const inspectImageInputSchema = {
  attachmentId: z.string().uuid().describe("当前会话图片附件的 attachmentId。"),
  instruction: z.string().min(1).max(1000).describe("对该图片的观察指令。"),
} satisfies z.ZodRawShape;

interface InspectImageDependencies {
  attachments: {
    resolve(
      workspaceId: string,
      sessionId: string,
      attachmentId: string
    ): Promise<ResolvedAttachment>;
  };
  normalizer: ImageNormalizer;
  settings: Pick<VisionSettingsStore, "load" | "resolveRoute">;
  capabilityResolver: {
    resolve(
      identity: ModelIdentity,
      settings: VisionSettings
    ): Promise<ImageInputCapability> | ImageInputCapability;
  };
  relay: Pick<VisionRelayModule, "inspect">;
}

const defaultDependencies: InspectImageDependencies = {
  attachments: attachmentResourceModule,
  normalizer: new ImageNormalizer(),
  settings: visionSettingsStore,
  capabilityResolver: {
    async resolve(identity, settings) {
      const configured = await providerManager.getProviderByIdWithKey(identity.providerId);
      if (!configured) return "unknown";
      return (await createRuntimeModelCapabilityResolver(
        settings.capabilityOverrides
      )).resolve(identity, { providerType: configured.provider.providerType });
    },
  },
  relay: new VisionRelayModule(new PiVisionProviderAdapter()),
};

function errorResult(code: string): ProvisionedToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ status: "error", code }) }],
    isError: true,
  };
}

export class InspectImageModule {
  constructor(private readonly dependencies: InspectImageDependencies = defaultDependencies) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolCallContext
  ): Promise<ProvisionedToolResult> {
    const parsed = z.object(inspectImageInputSchema).safeParse(args);
    if (!parsed.success) return errorResult("VISION_INPUT_INVALID");

    let resolved: ResolvedAttachment;
    try {
      resolved = await this.dependencies.attachments.resolve(
        context.workspaceId,
        context.sessionId,
        parsed.data.attachmentId
      );
    } catch {
      return errorResult("VISION_ATTACHMENT_NOT_FOUND");
    }
    if (resolved.record.category !== "image") {
      return errorResult("VISION_ATTACHMENT_FORBIDDEN");
    }

    let image;
    try {
      image = await this.dependencies.normalizer.normalize(
        resolved.filePath,
        resolved.record.mimeType,
        resolved.record.size
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return errorResult(
        message === "IMAGE_TOO_LARGE" || message === "IMAGE_PIXEL_LIMIT_EXCEEDED"
          ? "VISION_IMAGE_TOO_LARGE"
          : "VISION_UNSUPPORTED_IMAGE"
      );
    }

    const settings = await this.dependencies.settings.load();
    const capability = await this.dependencies.capabilityResolver.resolve(
      context.mainModel,
      settings
    );
    if (capability === "supported") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "ok",
              path: "direct",
              attachmentId: resolved.record.attachmentId,
              filename: resolved.record.filename,
            }),
          },
          { type: "image", data: image.data, mimeType: image.mimeType },
        ],
      };
    }

    if (
      context.runOrigin === "schedule" ||
      context.runOrigin === "memory" ||
      context.agentId
    ) {
      return errorResult("VISION_PERMISSION_DENIED");
    }

    let target;
    try {
      target = await this.dependencies.settings.resolveRoute();
    } catch {
      return errorResult("VISION_ROUTE_UNAVAILABLE");
    }
    if (!target) {
      return errorResult(
        capability === "unknown"
          ? "MODEL_IMAGE_CAPABILITY_UNKNOWN"
          : "VISION_NOT_CONFIGURED"
      );
    }

    try {
      const startedAt = Date.now();
      const output = await this.dependencies.relay.inspect({
        sessionId: context.sessionId,
        image,
        instruction: parsed.data.instruction,
        target,
        signal: context.signal,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ok",
            path: "relay",
            providerId: target.providerId,
            modelId: target.modelId,
            durationMs: Date.now() - startedAt,
            attempts: output.attempts,
            result: output.observation,
            safety: { untrustedSource: true },
          }),
        }],
      };
    } catch (error) {
      const code =
        error instanceof Error && /^VISION_[A-Z_]+$/.test(error.message)
          ? error.message
          : "VISION_PROVIDER_ERROR";
      return errorResult(code);
    }
  }
}

export const inspectImageModule = new InspectImageModule();
