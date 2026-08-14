export const AGENT_DISCLOSURE_START_EVENT = "zora:agent-disclosure-start";
export const AGENT_DISCLOSURE_SETTLED_EVENT = "zora:agent-disclosure-settled";

export function calculateStreamingBodyScrollAdjustment(
  contentHeightDelta: number,
  bodyHeightDelta: number
): number {
  if (contentHeightDelta <= 0 || bodyHeightDelta <= 0) {
    return 0;
  }

  return Math.min(contentHeightDelta, bodyHeightDelta);
}

export function captureViewportAnchor(element: HTMLElement): () => void {
  const viewport = element.closest<HTMLElement>("[data-message-scroll-container='true']");
  if (!viewport) {
    return () => undefined;
  }

  const topBefore = element.getBoundingClientRect().top;
  viewport.dispatchEvent(new Event(AGENT_DISCLOSURE_START_EVENT));

  return () => {
    if (element.isConnected && viewport.isConnected) {
      const topDelta = element.getBoundingClientRect().top - topBefore;
      if (Math.abs(topDelta) > 0.5) {
        viewport.scrollTop += topDelta;
      }
    }
    if (viewport.isConnected) {
      viewport.dispatchEvent(new Event(AGENT_DISCLOSURE_SETTLED_EVENT));
    }
  };
}
