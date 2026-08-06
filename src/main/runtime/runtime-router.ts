import type { RuntimeType } from "../../shared/zora";
import { logSystemEvent } from "../system-log";
import type {
  RuntimeAdapter,
  RuntimeStartInput,
  RuntimeRunHandle,
} from "./types";
import { RuntimeNotAvailableError } from "./types";

export class RuntimeRouter {
  private adapters = new Map<RuntimeType, RuntimeAdapter>();

  registerAdapter(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  start(input: RuntimeStartInput): RuntimeRunHandle {
    const runtime = input.target.runtimeType;
    const adapter = this.adapters.get(runtime);
    if (!adapter) {
      throw new RuntimeNotAvailableError(runtime, "adapter_not_registered");
    }
    logSystemEvent(
      "agent",
      "runtime-router",
      "dispatch",
      "Runtime 已分发",
      {
        sessionId: input.harness.sessionId,
        workspaceId: input.harness.workspaceId,
        runtimeType: runtime,
        providerId: input.target.provider.id,
        selectedModelId: input.target.modelId,
      }
    );
    return adapter.start(input);
  }

  dispose(): void {
    for (const adapter of this.adapters.values()) {
      adapter.dispose();
    }
  }
}
