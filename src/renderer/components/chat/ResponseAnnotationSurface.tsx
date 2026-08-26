import {
  type MouseEvent as ReactMouseEvent,
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
import {
  draftResponseAnnotationsAtom,
  setDraftResponseAnnotationAtom,
} from "../../store/chat";
import {
  captureResponseSelection,
  restoreResponseAnnotationRange,
  type CapturedResponseSelection,
} from "../../utils/responseAnnotationRange";
import {
  RESPONSE_ANNOTATION_ACTION_EVENT,
  type ResponseAnnotationAction,
} from "../../utils/responseAnnotationEvents";
import { AnnotationIcon } from "../ui/Icons";

const HIGHLIGHT_NAME = "zora-response-annotation";
const HIGHLIGHT_STYLE_ID = "zora-response-annotation-highlight-style";

function ensureHighlightStyle() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent =
    "::highlight(zora-response-annotation){background-color:rgb(186 230 253 / .72);color:inherit}";
  document.head.append(style);
}

interface ResolvedAnnotation {
  annotation: ResponseAnnotation;
  range: Range;
  left: number;
  top: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
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
  const ownsHighlightRef = useRef(false);
  const annotations = useAtomValue(draftResponseAnnotationsAtom);
  const setAnnotation = useSetAtom(setDraftResponseAnnotationAtom);
  const [selection, setSelection] =
    useState<CapturedResponseSelection | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedAnnotation[]>([]);
  const [locatedAnnotationId, setLocatedAnnotationId] = useState<string | null>(
    null
  );

  const messageAnnotations = useMemo(
    () =>
      annotations
        .filter((annotation) => annotation.sourceMessageId === messageId)
        .sort(
          (left, right) =>
            left.anchor.startOffset - right.anchor.startOffset ||
            left.anchor.endOffset - right.anchor.endOffset
        ),
    [annotations, messageId]
  );
  const editingExisting = selection
    ? annotations.some(
        (annotation) =>
          annotation.sourceMessageId === messageId &&
          annotation.anchor.startOffset === selection.anchor.startOffset &&
          annotation.anchor.endOffset === selection.anchor.endOffset
      )
    : false;

  const rebuildHighlights = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const surfaceRect = surface.getBoundingClientRect();
    const next = messageAnnotations.flatMap((annotation) => {
      const range = restoreResponseAnnotationRange(surface, annotation.anchor);
      if (!range) return [];
      const rects = Array.from(range.getClientRects());
      const lastRect = rects.at(-1) ?? range.getBoundingClientRect();
      return [
        {
          annotation,
          range,
          left: Math.max(0, lastRect.right - surfaceRect.left + 4),
          top: Math.max(0, lastRect.bottom - surfaceRect.top - 18),
        },
      ];
    });
    setResolved(next);
    if (typeof CSS !== "undefined" && "highlights" in CSS) {
      if (next.length > 0) {
        CSS.highlights.set(
          HIGHLIGHT_NAME,
          new Highlight(...next.map((item) => item.range))
        );
        ownsHighlightRef.current = true;
      } else if (ownsHighlightRef.current) {
        CSS.highlights.delete(HIGHLIGHT_NAME);
        ownsHighlightRef.current = false;
      }
    }
  };

  useLayoutEffect(() => {
    ensureHighlightStyle();
    rebuildHighlights();
    const surface = surfaceRef.current;
    const observer =
      surface && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(rebuildHighlights)
        : null;
    if (surface && observer) observer.observe(surface);
    return () => {
      observer?.disconnect();
      if (
        typeof CSS !== "undefined" &&
        "highlights" in CSS &&
        ownsHighlightRef.current
      ) {
        CSS.highlights.delete(HIGHLIGHT_NAME);
        ownsHighlightRef.current = false;
      }
    };
  }, [messageAnnotations]);

  useEffect(() => {
    if (!selection) return;
    const close = () => {
      if (!editing) setSelection(null);
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [editing, selection]);

  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  const captureSelection = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button,textarea,input")) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const captured = captureResponseSelection(surface, messageId);
    setSelection(captured);
    setEditing(false);
    setComment("");
    setError(null);
  };

  const openEditor = (captured: CapturedResponseSelection) => {
    const existing = annotations.find(
      (annotation) =>
        annotation.sourceMessageId === messageId &&
        annotation.anchor.startOffset === captured.anchor.startOffset &&
        annotation.anchor.endOffset === captured.anchor.endOffset
    );
    setSelection(captured);
    setComment(existing?.comment ?? "");
    setEditing(true);
    setError(null);
  };

  const saveAnnotation = () => {
    if (!selection) return;
    const existing = annotations.find(
      (annotation) =>
        annotation.sourceMessageId === messageId &&
        annotation.anchor.startOffset === selection.anchor.startOffset &&
        annotation.anchor.endOffset === selection.anchor.endOffset
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
    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<{
        annotationId: string;
        action: ResponseAnnotationAction;
      }>).detail;
      const item = resolved.find(
        (candidate) => candidate.annotation.id === detail.annotationId
      );
      if (!item) return;
      surface.scrollIntoView({ behavior: "smooth", block: "center" });
      setLocatedAnnotationId(item.annotation.id);
      window.setTimeout(() => setLocatedAnnotationId(null), 1200);
    };
    surface.addEventListener(RESPONSE_ANNOTATION_ACTION_EVENT, handleAction);
    return () =>
      surface.removeEventListener(RESPONSE_ANNOTATION_ACTION_EVENT, handleAction);
  }, [resolved]);

  const popover = selection ? (
    <div
      data-testid="response-annotation-popover"
      className="fixed z-[120]"
      style={{
        top: clamp(selection.placementRect.bottom + 8, 8, window.innerHeight - 180),
        left: clamp(
          selection.placementRect.left + selection.placementRect.width / 2 -
            (editing ? 160 : 72),
          8,
          window.innerWidth - (editing ? 328 : 152)
        ),
      }}
    >
      {editing ? (
        <div className="w-80 rounded-2xl border border-stone-200 bg-white p-3 shadow-xl">
          <textarea
            ref={editorRef}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setSelection(null);
                setEditing(false);
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
            rows={2}
            aria-label="批注评论"
            placeholder="添加评论，可选…"
            className="max-h-36 min-h-16 w-full resize-none border-0 bg-transparent text-[13px] leading-5 text-stone-800 outline-none placeholder:text-stone-400"
          />
          {error ? (
            <p role="alert" className="mt-1 text-xs text-rose-600">
              {error}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSelection(null);
                setEditing(false);
              }}
              className="h-8 rounded-full px-3 text-[13px] text-stone-600 hover:bg-stone-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={saveAnnotation}
              className="h-8 rounded-full bg-stone-900 px-3 text-[13px] font-medium text-white hover:bg-stone-800"
            >
              {editingExisting ? "保存" : "添加"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => openEditor(selection)}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-stone-200 bg-white px-4 text-[13px] font-medium text-stone-800 shadow-lg hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
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
      className="relative"
      onMouseUp={captureSelection}
    >
      {children}
      {resolved.map((item, index) => (
        <button
          key={item.annotation.id}
          type="button"
          onClick={() => openExisting(item)}
          aria-label={`编辑批注 ${index + 1}`}
          title={item.annotation.comment || item.annotation.anchor.selectedText}
          data-testid="response-annotation-marker"
          className={`absolute z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-600 px-1 text-[11px] font-semibold text-white shadow-sm ring-2 ring-white focus-visible:outline-none focus-visible:ring-sky-300 ${locatedAnnotationId === item.annotation.id ? "animate-pulse ring-4 ring-sky-300" : ""}`}
          style={{ left: item.left, top: item.top }}
        >
          {index + 1}
        </button>
      ))}
      {selection ? createPortal(popover, document.body) : null}
    </div>
  );
}
