import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useAtomValue, useSetAtom } from "jotai";
import type { ResponseAnnotation } from "../../types";
import { sortResponseAnnotations } from "../../../shared/response-annotations";
import {
  draftResponseAnnotationsAtom,
  setDraftResponseAnnotationAtom,
} from "../../store/chat";
import {
  calculateResponseAnnotationEditorPosition,
  calculateResponseAnnotationPopoverPosition,
  captureResponseSelection,
  restoreResponseAnnotationRange,
  type CapturedResponseSelection,
} from "../../utils/responseAnnotationRange";
import { RESPONSE_ANNOTATION_LOCATE_EVENT } from "../../utils/responseAnnotationEvents";
import { AnnotationIcon } from "../ui/Icons";

interface ResolvedAnnotation {
  annotation: ResponseAnnotation;
  range: Range;
  highlightRects: ActiveHighlightRect[];
  left: number;
  top: number;
}

interface ActiveHighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function findMatchingAnnotation(
  annotations: ResponseAnnotation[],
  messageId: string,
  anchor: ResponseAnnotation["anchor"]
) {
  return annotations.find(
    (annotation) =>
      annotation.sourceMessageId === messageId &&
      annotation.anchor.startOffset === anchor.startOffset &&
      annotation.anchor.endOffset === anchor.endOffset
  );
}

export function ResponseAnnotationSurface({
  messageId,
  children,
}: {
  messageId: string;
  children: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const annotations = useAtomValue(draftResponseAnnotationsAtom);
  const setAnnotation = useSetAtom(setDraftResponseAnnotationAtom);
  const [selection, setSelection] =
    useState<CapturedResponseSelection | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedAnnotation[]>([]);
  const [activeHighlightRects, setActiveHighlightRects] = useState<
    ActiveHighlightRect[]
  >([]);
  const [locatedAnnotationId, setLocatedAnnotationId] = useState<string | null>(
    null
  );
  const [popoverPosition, setPopoverPosition] = useState({
    left: 12,
    top: 12,
    side: "top" as "top" | "bottom" | "right",
  });

  const messageAnnotations = useMemo(
    () =>
      sortResponseAnnotations(
        annotations.filter(
          (annotation) => annotation.sourceMessageId === messageId
        )
      ),
    [annotations, messageId]
  );
  const editingExisting = selection
    ? Boolean(findMatchingAnnotation(annotations, messageId, selection.anchor))
    : false;

  const rebuildHighlights = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const surfaceRect = surface.getBoundingClientRect();
    const occupiedMarkerTops: number[] = [];
    const next = messageAnnotations.flatMap((annotation) => {
      const range = restoreResponseAnnotationRange(surface, annotation.anchor);
      if (!range) return [];
      const rects = Array.from(range.getClientRects());
      const fallbackRect = range.getBoundingClientRect();
      const top = Math.min(...(rects.length > 0 ? rects : [fallbackRect]).map(
        (rect) => rect.top
      ));
      const topLineRect = (rects.length > 0 ? rects : [fallbackRect])
        .filter((rect) => Math.abs(rect.top - top) <= 2)
        .reduce((rightmost, rect) =>
          rect.right > rightmost.right ? rect : rightmost
        );
      const markerSize = 18;
      let markerTop = topLineRect.top - surfaceRect.top;
      while (
        occupiedMarkerTops.some(
          (occupiedTop) => Math.abs(occupiedTop - markerTop) < markerSize + 2
        )
      ) {
        markerTop += markerSize + 2;
      }
      occupiedMarkerTops.push(markerTop);
      return [
        {
          annotation,
          range,
          highlightRects: rects.map((rect) => ({
            left: rect.left - surfaceRect.left,
            top: rect.top - surfaceRect.top,
            width: rect.width,
            height: rect.height,
          })),
          left: Math.max(0, surfaceRect.width - markerSize),
          top: markerTop,
        },
      ];
    });
    setResolved(next);
  };

  useLayoutEffect(() => {
    rebuildHighlights();
    const surface = surfaceRef.current;
    const observer =
      surface && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(rebuildHighlights)
        : null;
    if (surface && observer) observer.observe(surface);
    return () => {
      observer?.disconnect();
    };
  }, [messageAnnotations]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!selection || !surface || !editing) {
      setActiveHighlightRects([]);
      return;
    }
    const surfaceRect = surface.getBoundingClientRect();
    setActiveHighlightRects(
      Array.from(selection.range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          left: rect.left - surfaceRect.left,
          top: rect.top - surfaceRect.top,
          width: rect.width,
          height: rect.height,
        }))
    );
  }, [editing, selection]);

  const closePopover = () => {
    setSelection(null);
    setEditing(false);
    setComment("");
    setError(null);
  };

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editing || !editor) return;
    editor.style.height = "0px";
    const height = Math.min(Math.max(editor.scrollHeight, 32), 120);
    editor.style.height = `${height}px`;
    editor.style.overflowY = editor.scrollHeight > 120 ? "auto" : "hidden";
  }, [comment, editing]);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!selection || !popover) return;
    const rects = Array.from(selection.range.getClientRects());
    const fallbackRect = selection.placementRect;
    const positionCalculator = editing
      ? calculateResponseAnnotationEditorPosition
      : calculateResponseAnnotationPopoverPosition;
    const position = positionCalculator(
      rects.length > 0 ? rects : [fallbackRect],
      { width: popover.offsetWidth, height: popover.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setPopoverPosition(position);
  }, [comment, editing, selection]);

  useLayoutEffect(() => {
    const captureSelection = (event: MouseEvent) => {
      if ((event.target as Element).closest("button,textarea,input")) return;
      const surface = surfaceRef.current;
      if (!surface) return;
      const captured = captureResponseSelection(surface, messageId);
      setSelection(captured);
      setEditing(false);
      setComment("");
      setError(null);
    };
    document.addEventListener("mouseup", captureSelection);
    return () => document.removeEventListener("mouseup", captureSelection);
  }, [messageId]);

  useEffect(() => {
    if (!selection) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      closePopover();
    };
    const closeOnViewportChange = () => closePopover();
    const closeOnScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      closePopover();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("resize", closeOnViewportChange);
    document.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("resize", closeOnViewportChange);
      document.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [selection]);

  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  const openEditor = (captured: CapturedResponseSelection) => {
    const existing = findMatchingAnnotation(
      annotations,
      messageId,
      captured.anchor
    );
    setSelection(captured);
    setComment(existing?.comment ?? "");
    setEditing(true);
    setError(null);
  };

  const saveAnnotation = () => {
    if (!selection) return;
    const existing = findMatchingAnnotation(
      annotations,
      messageId,
      selection.anchor
    );
    try {
      setAnnotation({
        id: existing?.id ?? crypto.randomUUID(),
        sourceMessageId: messageId,
        anchor: selection.anchor,
        comment: comment.trim() || undefined,
      });
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      setEditing(false);
      setComment("");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加批注失败");
    }
  };

  const openExisting = (item: ResolvedAnnotation) => {
    openEditor({
      sourceMessageId: messageId,
      anchor: item.annotation.anchor,
      range: item.range.cloneRange(),
      placementRect: item.range.getBoundingClientRect(),
    });
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const handleLocate = (event: Event) => {
      const detail = (event as CustomEvent<{ annotationId: string }>).detail;
      const item = resolved.find(
        (candidate) => candidate.annotation.id === detail.annotationId
      );
      if (!item) return;
      const marker = Array.from(
        surface.querySelectorAll<HTMLElement>(
          "[data-response-annotation-id]"
        )
      ).find(
        (element) =>
          element.dataset.responseAnnotationId === item.annotation.id
      );
      marker?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
      setLocatedAnnotationId(item.annotation.id);
    };
    surface.addEventListener(RESPONSE_ANNOTATION_LOCATE_EVENT, handleLocate);
    return () =>
      surface.removeEventListener(RESPONSE_ANNOTATION_LOCATE_EVENT, handleLocate);
  }, [resolved]);

  useEffect(() => {
    if (!locatedAnnotationId) return;
    const timer = window.setTimeout(() => setLocatedAnnotationId(null), 1200);
    return () => window.clearTimeout(timer);
  }, [locatedAnnotationId]);

  const popover = selection ? (
    <div
      ref={popoverRef}
      data-testid="response-annotation-popover"
      className="fixed z-[120]"
      style={{
        top: popoverPosition.top,
        left: popoverPosition.left,
      }}
      data-placement={popoverPosition.side}
    >
      {editing ? (
        <div className="w-[312px] rounded-xl border border-stone-200 bg-white p-2.5 shadow-[0_8px_28px_rgba(41,37,36,0.16)]">
          <textarea
            ref={editorRef}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closePopover();
                return;
              }
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                saveAnnotation();
              }
            }}
            rows={1}
            aria-label="批注评论"
            placeholder="添加评论，可选…"
            className="min-h-8 w-full resize-none border-0 bg-transparent text-[13px] leading-5 text-stone-800 outline-none placeholder:text-stone-400"
          />
          {error ? (
            <p role="alert" className="mt-1 text-xs text-rose-600">
              {error}
            </p>
          ) : null}
          <div className="mt-1.5 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={closePopover}
              className="h-7 rounded-full px-2.5 text-[13px] text-stone-600 hover:bg-stone-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={saveAnnotation}
              className="h-7 rounded-full bg-stone-900 px-2.5 text-[13px] font-medium text-white hover:bg-stone-800"
            >
              {editingExisting ? "保存" : "添加"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => openEditor(selection)}
          className="inline-flex h-9 min-w-[116px] items-center justify-center gap-2 rounded-[8px] border border-stone-200 bg-white px-3.5 text-[13px] font-medium text-stone-800 shadow-[0_5px_18px_rgba(41,37,36,0.15)] transition-[background-color,border-color,box-shadow] hover:border-stone-300 hover:bg-stone-50 hover:shadow-[0_7px_22px_rgba(41,37,36,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
        >
          <AnnotationIcon className="h-4 w-4" />
          添加批注
        </button>
      )}
    </div>
  ) : null;

  return (
    <div
      ref={surfaceRef}
      data-response-annotation-surface={messageId}
      className="relative pr-7"
    >
      <div
        data-testid="response-annotation-content"
        className="relative z-[1]"
      >
        {children}
      </div>
      {activeHighlightRects.map((rect, index) => (
        <span
          key={`${rect.left}-${rect.top}-${index}`}
          aria-hidden="true"
          data-testid="active-response-annotation-highlight"
          className="pointer-events-none absolute z-0"
          style={{
            ...rect,
            backgroundColor: "var(--color-annotation-active)",
            boxShadow:
              "inset 0 -2px 0 var(--color-annotation-line)",
          }}
        />
      ))}
      {resolved.flatMap((item) =>
        item.highlightRects.map((rect, index) => (
          <span
            key={`underline-${item.annotation.id}-${index}`}
            aria-hidden="true"
            data-testid="saved-response-annotation-underline"
            className="pointer-events-none absolute z-0"
            style={{
              ...rect,
              boxShadow: "inset 0 -2px 0 var(--color-annotation-line)",
            }}
          />
        ))
      )}
      {resolved
        .filter((item) => item.annotation.id === locatedAnnotationId)
        .flatMap((item) =>
          item.highlightRects.map((rect, index) => (
            <span
              key={`${item.annotation.id}-${index}`}
              aria-hidden="true"
              data-testid="response-annotation-location-highlight"
              className="pointer-events-none absolute z-0 animate-pulse"
              style={{
                ...rect,
                backgroundColor: "var(--color-annotation-active)",
                boxShadow:
                  "inset 0 -2px 0 var(--color-annotation-line)",
              }}
            />
          ))
        )}
      {resolved.map((item, index) => (
        <button
          key={item.annotation.id}
          type="button"
          onClick={() => openExisting(item)}
          aria-label={`编辑批注 ${index + 1}`}
          title={item.annotation.comment || item.annotation.anchor.selectedText}
          data-testid="response-annotation-marker"
          data-response-annotation-id={item.annotation.id}
          className={`absolute z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white shadow-sm ring-2 ring-white focus-visible:outline-none focus-visible:ring-amber-300 ${locatedAnnotationId === item.annotation.id ? "animate-pulse ring-4 ring-amber-300" : ""}`}
          style={{
            left: item.left,
            top: item.top,
            backgroundColor: "var(--color-annotation-line)",
          }}
        >
          {index + 1}
        </button>
      ))}
      {selection ? createPortal(popover, document.body) : null}
    </div>
  );
}
