import {
  AGENT_DISCLOSURE_SETTLED_EVENT,
  AGENT_DISCLOSURE_START_EVENT,
  calculateStreamingBodyScrollAdjustment,
  captureViewportAnchor,
} from "@/renderer/utils/scrollAnchor";

describe("calculateStreamingBodyScrollAdjustment", () => {
  it("does not move the viewport when only the process trace grows", () => {
    expect(calculateStreamingBodyScrollAdjustment(24, 0)).toBe(0);
  });

  it("follows visible streaming body growth without exceeding total content growth", () => {
    expect(calculateStreamingBodyScrollAdjustment(24, 24)).toBe(24);
    expect(calculateStreamingBodyScrollAdjustment(100, 40)).toBe(40);
    expect(calculateStreamingBodyScrollAdjustment(12, 40)).toBe(12);
    expect(calculateStreamingBodyScrollAdjustment(-20, 20)).toBe(0);
  });
});

describe("captureViewportAnchor", () => {
  it("restores the clicked row after an outer resize-follow scroll", () => {
    const viewport = document.createElement("div");
    viewport.dataset.messageScrollContainer = "true";
    const button = document.createElement("button");
    viewport.append(button);
    document.body.append(viewport);

    let scrollTop = 300;
    let buttonTop = 250;
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    vi.spyOn(button, "getBoundingClientRect").mockImplementation(
      () => ({ top: buttonTop }) as DOMRect
    );

    const restore = captureViewportAnchor(button);
    const onStart = vi.fn();
    const onSettled = vi.fn();
    viewport.addEventListener(AGENT_DISCLOSURE_START_EVENT, onStart);
    viewport.addEventListener(AGENT_DISCLOSURE_SETTLED_EVENT, onSettled);

    const secondRestore = captureViewportAnchor(button);
    expect(onStart).toHaveBeenCalledTimes(1);
    scrollTop = 420;
    buttonTop = 130;
    secondRestore();

    expect(scrollTop).toBe(300);
    expect(onSettled).toHaveBeenCalledTimes(1);
    restore();
  });
});
