import type {
  AgentRuntimeType,
  ManualCompactionResult,
} from "../../shared/zora";
import { logSystemEvent } from "../system-log";
import type {
  AgentRuntimeAdapter,
  AgentRuntimeInput,
  AgentRuntimeHandle,
} from "./types";
import { AgentRuntimeNotAvailableError } from "./types";

export class AgentRuntimeRouter {
  private adapters = new Map<AgentRuntimeType, AgentRuntimeAdapter>();

  registerAdapter(adapter: AgentRuntimeAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  start(input: AgentRuntimeInput): AgentRuntimeHandle {
    const runtime = input.target.agentRuntimeType;
    const adapter = this.adapters.get(runtime);
    if (!adapter) {
      throw new AgentRuntimeNotAvailableError(runtime, "adapter_not_registered");
    }
    logSystemEvent(
      "agent",
      "runtime-router",
      "dispatch",
      "Runtime 已分发",
      {
        sessionId: input.harness.sessionId,
        workspaceId: input.harness.workspaceId,
        agentRuntimeType: runtime,
        providerId: input.target.provider.id,
        selectedModelId: input.target.modelId,
      }
    );
    return adapter.start(input);
  }

  compact(input: AgentRuntimeInput): Promise<ManualCompactionResult> {
    const runtime = input.target.agentRuntimeType;
    const adapter = this.adapters.get(runtime);
    if (!adapter) {
      throw new AgentRuntimeNotAvailableError(runtime, "adapter_not_registered");
    }
    return adapter.compact(input);
  }

  deleteSessionData(sessionId: string, workspaceId: string): void {
    for (const adapter of this.adapters.values()) {
      adapter.deleteSessionData(sessionId, workspaceId);
    }
  }

  dispose(): void {
    for (const adapter of this.adapters.values()) {
      adapter.dispose();
    }
  }
}
