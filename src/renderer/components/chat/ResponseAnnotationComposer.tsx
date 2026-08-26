import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { sortResponseAnnotations } from "../../../shared/response-annotations";
import {
  draftResponseAnnotationsAtom,
  removeDraftResponseAnnotationAtom,
  setDraftResponseAnnotationAtom,
} from "../../store/chat";
import {
  findResponseAnnotationSurface,
  requestResponseAnnotationAction,
} from "../../utils/responseAnnotationEvents";
import {
  AnnotationIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  LocateIcon,
  TrashIcon,
} from "../ui/Icons";

export function ResponseAnnotationComposer() {
  const annotations = useAtomValue(draftResponseAnnotationsAtom);
  const removeAnnotation = useSetAtom(removeDraftResponseAnnotationAtom);
  const setAnnotation = useSetAtom(setDraftResponseAnnotationAtom);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState("");
  const open = pinned || hovered;

  useEffect(() => {
    if (!open) return;
    const refresh = () => setAvailabilityVersion((value) => value + 1);
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, [open]);

  if (annotations.length === 0) return null;
  const ordered = sortResponseAnnotations(annotations);

  return (
    <div
      className="mb-2 px-1"
      data-testid="draft-response-annotations"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setHovered(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setPinned((current) => !current)}
        aria-expanded={open}
        aria-label={`${ordered.length} 条批注`}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3 text-[13px] font-medium text-stone-700 transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
      >
        <AnnotationIcon className="h-4 w-4" />
        <span>{ordered.length} 条批注</span>
      </button>

      {open ? (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-stone-200 bg-white p-2 shadow-lg">
          {ordered.map((annotation, index) => {
            void availabilityVersion;
            const sourceAvailable = Boolean(
              findResponseAnnotationSurface(annotation.sourceMessageId)
            );
            return (
              <div
                key={annotation.id}
                className="flex items-start gap-2 rounded-xl px-2 py-2 hover:bg-stone-50"
              >
              <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-100 px-1 text-[11px] font-semibold text-sky-700">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 border-l-2 border-stone-300 pl-2 whitespace-pre-wrap text-[13px] leading-5 text-stone-500">
                  {annotation.anchor.selectedText}
                </p>
                {editingId === annotation.id ? (
                  <div className="mt-1.5 flex items-end gap-1">
                    <textarea
                      autoFocus
                      rows={2}
                      value={editingComment}
                      onChange={(event) => setEditingComment(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingId(null);
                          return;
                        }
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          setAnnotation({
                            ...annotation,
                            comment: editingComment.trim() || undefined,
                          });
                          setEditingId(null);
                        }
                      }}
                      aria-label={`编辑批注 ${index + 1}`}
                      className="min-h-14 flex-1 resize-none rounded-lg border border-stone-200 px-2 py-1.5 text-[12px] leading-5 text-stone-700 outline-none focus:border-stone-400"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setAnnotation({
                          ...annotation,
                          comment: editingComment.trim() || undefined,
                        });
                        setEditingId(null);
                      }}
                      aria-label={`保存批注 ${index + 1}`}
                      title="保存"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      aria-label={`取消编辑批注 ${index + 1}`}
                      title="取消"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : annotation.comment ? (
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-stone-500">
                    {annotation.comment}
                  </p>
                ) : null}
              </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      requestResponseAnnotationAction(
                        annotation.sourceMessageId,
                        annotation.id,
                        "locate"
                      )
                    }
                    disabled={!sourceAvailable}
                    aria-label={`定位批注 ${index + 1}`}
                    title={sourceAvailable ? "定位原文" : "原文位置不可用"}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                  >
                    <LocateIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(annotation.id);
                      setEditingComment(annotation.comment ?? "");
                    }}
                    aria-label={`编辑批注 ${index + 1}`}
                    title="编辑批注"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAnnotation(annotation.id)}
                    aria-label={`删除批注 ${index + 1}`}
                    title="删除批注"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
