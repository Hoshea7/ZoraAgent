import type { ResponseAnnotation } from "./zora";

export const DEFAULT_RESPONSE_ANNOTATION_PROMPT =
  "请基于以下评论批注内容给出反馈。";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function requireOffset(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }
  return value as number;
}

export function sortResponseAnnotations(
  annotations: readonly ResponseAnnotation[]
): ResponseAnnotation[] {
  return [...annotations].sort(
    (left, right) =>
      left.anchor.startOffset - right.anchor.startOffset ||
      left.anchor.endOffset - right.anchor.endOffset ||
      left.id.localeCompare(right.id)
  );
}

export function normalizeResponseAnnotations(
  value: unknown
): ResponseAnnotation[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("responseAnnotations must be an array.");
  }
  if (value.length === 0) return undefined;

  const ids = new Set<string>();
  let sourceMessageId: string | undefined;
  const annotations = value.map((item, index): ResponseAnnotation => {
    if (!isRecord(item) || !isRecord(item.anchor)) {
      throw new Error(`responseAnnotations[${index}] is invalid.`);
    }

    const id = requireNonEmptyString(item.id, `responseAnnotations[${index}].id`);
    if (ids.has(id)) {
      throw new Error(`Duplicate response annotation id: ${id}`);
    }
    ids.add(id);

    const itemSourceMessageId = requireNonEmptyString(
      item.sourceMessageId,
      `responseAnnotations[${index}].sourceMessageId`
    );
    sourceMessageId ??= itemSourceMessageId;
    if (sourceMessageId !== itemSourceMessageId) {
      throw new Error("All response annotations must share one source message.");
    }

    const startOffset = requireOffset(
      item.anchor.startOffset,
      `responseAnnotations[${index}].anchor.startOffset`
    );
    const endOffset = requireOffset(
      item.anchor.endOffset,
      `responseAnnotations[${index}].anchor.endOffset`
    );
    if (endOffset <= startOffset) {
      throw new Error("Response annotation endOffset must exceed startOffset.");
    }
    const selectedText = requireNonEmptyString(
      item.anchor.selectedText,
      `responseAnnotations[${index}].anchor.selectedText`
    );
    const comment =
      typeof item.comment === "string" && item.comment.trim().length > 0
        ? item.comment.trim()
        : undefined;

    return {
      id,
      sourceMessageId: itemSourceMessageId,
      anchor: { startOffset, endOffset, selectedText },
      comment,
    };
  });

  return sortResponseAnnotations(annotations);
}

export function resolveUserMessageText(
  text: string,
  responseAnnotations?: readonly ResponseAnnotation[]
): string {
  const normalizedText = text.trim();
  if (normalizedText) return normalizedText;
  return responseAnnotations?.length
    ? DEFAULT_RESPONSE_ANNOTATION_PROMPT
    : "";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function formatUserMessageForRuntime(input: {
  text: string;
  responseAnnotations?: readonly ResponseAnnotation[];
}): string {
  const text = resolveUserMessageText(input.text, input.responseAnnotations);
  const annotations = input.responseAnnotations?.length
    ? sortResponseAnnotations(input.responseAnnotations)
    : [];
  if (annotations.length === 0) return text;

  const annotationBlocks = annotations.map((annotation, index) => {
    const lines = [
      `  <annotation index="${index + 1}">`,
      `    <selected_text>${escapeXml(annotation.anchor.selectedText)}</selected_text>`,
    ];
    if (annotation.comment) {
      lines.push(`    <comment>${escapeXml(annotation.comment)}</comment>`);
    }
    lines.push("  </annotation>");
    return lines.join("\n");
  });

  return [
    text,
    "",
    "<response_annotations>",
    ...annotationBlocks,
    "</response_annotations>",
  ].join("\n");
}
