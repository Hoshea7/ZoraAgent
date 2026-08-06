import { ClaudeRuntimeAdapter } from "./claude-adapter";
import { PiRuntimeAdapter } from "./pi-adapter";
import { RuntimeRouter } from "./runtime-router";

export const runtimeRouter = new RuntimeRouter();
runtimeRouter.registerAdapter(new ClaudeRuntimeAdapter());
runtimeRouter.registerAdapter(new PiRuntimeAdapter());
export type { RuntimeRouter } from "./runtime-router";
