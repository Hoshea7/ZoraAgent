import { askUserQuestion, authorizeProductTool } from "../hitl";
import type { AgentStreamEvent } from "../../shared/zora";
import type {
  AskUserQuestionRequest,
  ToolAuthorizationRequest,
  ToolGate,
} from "../runtime/tool-gate";

export class ProductToolGate implements ToolGate {
  constructor(
    private readonly onEvent: (event: AgentStreamEvent) => void,
    private readonly sessionId: string,
    private readonly autoAllowedTools: ReadonlySet<string>
  ) {}

  authorize(req: ToolAuthorizationRequest) {
    if (this.autoAllowedTools.has(req.tool)) {
      return Promise.resolve({ behavior: "allow" } as const);
    }
    return authorizeProductTool(this.onEvent, this.sessionId, req);
  }

  ask(req: AskUserQuestionRequest) {
    return askUserQuestion(this.onEvent, this.sessionId, req);
  }
}
