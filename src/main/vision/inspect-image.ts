import { z } from "zod";
import type {
  ToolCallContext,
} from "../../shared/types/vision";
import {
  attachmentResourceModule,
  type ResolvedAttachment,
} from "../attachment-resource";
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
  settings: Pick<VisionSettingsStore, "resolveRoute">;
  relay: Pick<VisionRelayModule, "inspect">;
}

const defaultDependencies: InspectImageDependencies = {
  attachments: attachmentResourceModule,
  normalizer: new ImageNormalizer(),
  settings: visionSettingsStore,
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

    if (
      context.runOrigin === "schedule" ||
      context.runOrigin === "memory" ||
      context.agentId
    ) {
      return errorResult("VISION_PERMISSION_DENIED");
    }
    if (context.imageInputCapability === "supported") {
      return errorResult("VISION_TOOL_UNAVAILABLE");
    }
    if (!context.visionRelayEnabled) {
      return errorResult("VISION_ROUTE_UNAVAILABLE");
    }

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

    let target;
    try {
      target = await this.dependencies.settings.resolveRoute();
    } catch {
      return errorResult("VISION_ROUTE_UNAVAILABLE");
    }
    if (!target) {
      return errorResult("VISION_ROUTE_UNAVAILABLE");
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
