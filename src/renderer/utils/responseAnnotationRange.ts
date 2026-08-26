import type {
  ResponseAnnotationAnchor,
} from "../types";

export interface CapturedResponseSelection {
  sourceMessageId: string;
  anchor: ResponseAnnotationAnchor;
  range: Range;
  placementRect: DOMRect;
}

const EXCLUDED_SELECTOR = [
  "button",
  "input",
  "textarea",
  "svg",
  "script",
  "style",
  "[contenteditable]",
  '[aria-hidden="true"]',
  "[data-response-annotation-exclude]",
].join(",");

function isAllowedTextNode(surface: HTMLElement, node: Text): boolean {
  const parent = node.parentElement;
  return Boolean(
    parent &&
      surface.contains(parent) &&
      !parent.closest(EXCLUDED_SELECTOR)
  );
}

export function getAnnotationTextNodes(surface: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(
    surface,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return isAllowedTextNode(surface, node as Text)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    }
  );
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

function offsetForBoundary(
  nodes: readonly Text[],
  container: Node,
  offset: number
): number | null {
  if (container.nodeType !== Node.TEXT_NODE) return null;
  const index = nodes.indexOf(container as Text);
  if (index < 0) return null;
  const node = nodes[index];
  if (offset < 0 || offset > node.data.length) return null;
  return (
    nodes.slice(0, index).reduce((total, item) => total + item.data.length, 0) +
    offset
  );
}

export function captureResponseSelection(
  surface: HTMLElement,
  sourceMessageId: string,
  selection: Selection | null = window.getSelection()
): CapturedResponseSelection | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (
    !surface.contains(range.startContainer) ||
    !surface.contains(range.endContainer)
  ) {
    return null;
  }
  const nodes = getAnnotationTextNodes(surface);
  const startOffset = offsetForBoundary(
    nodes,
    range.startContainer,
    range.startOffset
  );
  const endOffset = offsetForBoundary(
    nodes,
    range.endContainer,
    range.endOffset
  );
  const selectedText = range.toString();
  if (
    startOffset === null ||
    endOffset === null ||
    endOffset <= startOffset ||
    selectedText.trim().length === 0
  ) {
    return null;
  }

  const clonedRange = range.cloneRange();
  return {
    sourceMessageId,
    anchor: { startOffset, endOffset, selectedText },
    range: clonedRange,
    placementRect: clonedRange.getBoundingClientRect(),
  };
}

function resolveBoundary(
  nodes: readonly Text[],
  targetOffset: number
): { node: Text; offset: number } | null {
  let consumed = 0;
  for (const node of nodes) {
    const next = consumed + node.data.length;
    if (targetOffset <= next) {
      return { node, offset: targetOffset - consumed };
    }
    consumed = next;
  }
  return null;
}

export function restoreResponseAnnotationRange(
  surface: HTMLElement,
  anchor: ResponseAnnotationAnchor
): Range | null {
  const nodes = getAnnotationTextNodes(surface);
  const start = resolveBoundary(nodes, anchor.startOffset);
  const end = resolveBoundary(nodes, anchor.endOffset);
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range.toString() === anchor.selectedText ? range : null;
}
