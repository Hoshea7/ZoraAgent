import type { SubtaskRole } from "../../shared/zora";

const DEFAULT_OUTPUT_REQUIREMENT =
  "最终回复请包含：关键发现、已执行操作、验证结果、剩余风险或建议。";

export function buildDelegationPrompt(input: {
  parentSessionId: string;
  delegationId: string;
  role: SubtaskRole;
  task: string;
  expectedOutput?: string;
}): string {
  const roleInstruction =
    input.role === "review"
      ? "审查已有内容，指出具体问题和风险，不修改文件。"
      : "探索代码和依赖，提供可验证的发现，不修改文件。";
  const outputRequirement =
    input.expectedOutput?.trim() || DEFAULT_OUTPUT_REQUIREMENT;
  return `你是 Zora 协作子 Agent。你由父 Agent 会话 ${input.parentSessionId} 委派创建，委派 ID 为 ${input.delegationId}。

## 工作边界
- 只处理下面的子任务，不要扩展到父任务的其他部分。
- 不创建新的协作子会话。
- 如需修改文件，保持改动最小，并在最终回复说明文件路径和验证结果。
- 如果信息不足，使用 AskUserQuestion 请求必要信息；无法获得时直接列出缺口，不要编造。
- 遇到无法解决的错误时，说明失败原因和已尝试的方法。

## 角色约束
${roleInstruction}

## 子任务
${input.task.trim()}

## 输出要求
${outputRequirement}`;
}

export function buildDelegationTaskWithSharedContext(input: {
  sharedContext?: string;
  task: string;
}): string {
  const sharedContext = input.sharedContext?.trim();
  const task = input.task.trim();
  if (!sharedContext) return task;
  return `共享背景：
${sharedContext}

子任务：
${task}`;
}
