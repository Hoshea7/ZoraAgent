export const RESPONSE_ANNOTATION_ACTION_EVENT =
  "zora:response-annotation-action";

export type ResponseAnnotationAction = "locate";

export function findResponseAnnotationSurface(messageId: string) {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-response-annotation-surface]")
  ).find(
    (element) =>
      element.dataset.responseAnnotationSurface === messageId
  );
}

export function requestResponseAnnotationAction(
  sourceMessageId: string,
  annotationId: string,
  action: ResponseAnnotationAction
) {
  const surface = findResponseAnnotationSurface(sourceMessageId);
  if (!surface) return false;
  surface.dispatchEvent(
    new CustomEvent(RESPONSE_ANNOTATION_ACTION_EVENT, {
      detail: { annotationId, action },
    })
  );
  return true;
}
