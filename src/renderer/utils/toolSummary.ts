import type { ProcessStep, ToolAction } from "../types";

export function cleanToolName(name: string): string {
  const cleaned = name.replace("default_api:", "").trim();
  return cleaned.length > 0 ? cleaned : "tool";
}

export function formatToolName(name: string): string {
  const cleaned = cleanToolName(name);
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function normalizeText(value: string, maxLength?: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!maxLength || normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function parseToolInput(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function getStringField(
  record: Record<string, unknown> | null,
  keys: string[]
): string | null {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function getBasename(value: string): string {
  const parts = value.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

export function getToolSummaryText(tool: ToolAction): string {
  const cleanName = cleanToolName(tool.name);
  const formattedName = formatToolName(tool.name);
  const lowerName = cleanName.toLowerCase();
  const parsed = parseToolInput(tool.input);

  if (lowerName === "bash") {
    const command = getStringField(parsed, ["command"]);
    return command ? normalizeText(command, 50) : formattedName;
  }

  if (["read", "readfile", "read_file", "write", "edit", "writefile", "write_file"].includes(lowerName)) {
    const filePath = getStringField(parsed, ["file_path", "path", "filePath"]);
    return filePath ? getBasename(filePath) : formattedName;
  }

  if (lowerName === "glob") {
    const pattern = getStringField(parsed, ["pattern"]);
    return pattern ? normalizeText(pattern) : formattedName;
  }

  if (["grep", "search"].includes(lowerName)) {
    const pattern = getStringField(parsed, ["pattern", "query"]);
    return pattern ? normalizeText(pattern) : formattedName;
  }

  return formattedName;
}

export function buildProcessSummary(steps: ProcessStep[], isStreaming: boolean): string {
  const tools = steps.filter(
    (step): step is Extract<ProcessStep, { type: "tool" }> => step.type === "tool"
  );
  const hasThinking = steps.some((step) => step.type === "thinking");

  if (isStreaming) {
    const runningTools = tools.filter((step) => step.tool.status === "running");
    const doneCount = tools.filter((step) => step.tool.status === "done").length;
    const runningTool = runningTools[runningTools.length - 1]?.tool;

    if (runningTool) {
      const toolName = formatToolName(runningTool.name);
      const toolSummary = getToolSummaryText(runningTool);
      const parts = [
        toolSummary !== toolName ? `${toolName} · ${toolSummary}` : toolName,
      ].filter(Boolean);
      if (doneCount > 0) {
        parts.push(`${doneCount} done`);
      }
      return parts.length > 0 ? parts.join(" · ") : "working...";
    }

    if (hasThinking && tools.length === 0) {
      return "analyzing...";
    }

    return "working...";
  }

  const parts: string[] = [];
  if (hasThinking) {
    parts.push("analyzed");
  }
  if (tools.length > 0) {
    parts.push(`${tools.length} tool calls`);
  }
  return parts.join(", ");
}
