import type {
  ResponseAnnotationAnchor,
} from "../types";

export interface CapturedResponseSelection {
  sourceMessageId: string;
  anchor: ResponseAnnotationAnchor;
  range: Range;
  placementRect: DOMRect;
}

interface ResponseAnnotationPopoverPosition {
  left: number;
  top: number;
  side: "top" | "bottom" | "right";
}

interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export function calculateResponseAnnotationPopoverPosition(
  rects: readonly RectLike[],
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 10,
  padding = 12
): ResponseAnnotationPopoverPosition {
  const visibleRects = rects.filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  const fallback: RectLike = {
    left: viewport.width / 2,
    right: viewport.width / 2,
    top: viewport.height / 2,
    bottom: viewport.height / 2,
    width: 0,
    height: 0,
  };
  const sourceRects = visibleRects.length > 0 ? visibleRects : [fallback];
  const minLeft = Math.min(...sourceRects.map((rect) => rect.left));
  const maxRight = Math.max(...sourceRects.map((rect) => rect.right));
  const minTop = Math.min(...sourceRects.map((rect) => rect.top));
  const maxBottom = Math.max(...sourceRects.map((rect) => rect.bottom));
  const lastRect = sourceRects.at(-1)!;
  const selectionCenter = (minLeft + maxRight) / 2;
  const selectionWidth = maxRight - minLeft;
  const shouldBiasToSelectionEnd =
    sourceRects.length > 1 || selectionWidth > Math.max(240, popover.width * 1.5);
  const anchorX = shouldBiasToSelectionEnd
    ? selectionCenter * 0.4 + lastRect.right * 0.6
    : (lastRect.left + lastRect.right) / 2;
  const maxLeft = Math.max(padding, viewport.width - padding - popover.width);
  const left = Math.min(
    Math.max(anchorX - popover.width / 2, padding),
    maxLeft
  );
  const topPlacement = minTop - gap - popover.height;
  if (topPlacement >= padding) {
    return { left, top: topPlacement, side: "top" };
  }

  return {
    left,
    top: Math.min(
      maxBottom + gap,
      Math.max(padding, viewport.height - padding - popover.height)
    ),
    side: "bottom",
  };
}

export function calculateResponseAnnotationEditorPosition(
  rects: readonly RectLike[],
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 12,
  padding = 12
): ResponseAnnotationPopoverPosition {
  const visibleRects = rects.filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  const sourceRects =
    visibleRects.length > 0
      ? visibleRects
      : [
          {
            left: viewport.width / 2,
            right: viewport.width / 2,
            top: viewport.height / 2,
            bottom: viewport.height / 2,
            width: 0,
            height: 0,
          },
        ];
  const maxRight = Math.max(...sourceRects.map((rect) => rect.right));
  const minTop = Math.min(...sourceRects.map((rect) => rect.top));
  const rightLeft = maxRight + gap;
  const left = Math.min(
    Math.max(rightLeft, padding),
    Math.max(padding, viewport.width - padding - popover.width)
  );
  const preferredTop = minTop - popover.height - gap;
  const top = Math.min(
    Math.max(preferredTop, padding),
    Math.max(padding, viewport.height - padding - popover.height)
  );

  return { left, top, side: "right" };
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

function getAnnotationTextNodes(surface: HTMLElement): Text[] {
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
