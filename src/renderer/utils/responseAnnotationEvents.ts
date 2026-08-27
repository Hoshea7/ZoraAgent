export const RESPONSE_ANNOTATION_LOCATE_EVENT =
  "zora:response-annotation-locate";

export function findResponseAnnotationSurface(messageId: string) {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-response-annotation-surface]")
  ).find(
    (element) =>
      element.dataset.responseAnnotationSurface === messageId
  );
}

export function requestResponseAnnotationLocation(
  sourceMessageId: string,
  annotationId: string
) {
  const surface = findResponseAnnotationSurface(sourceMessageId);
  if (!surface) return false;
  surface.dispatchEvent(
    new CustomEvent(RESPONSE_ANNOTATION_LOCATE_EVENT, {
      detail: { annotationId },
    })
  );
  return true;
}
