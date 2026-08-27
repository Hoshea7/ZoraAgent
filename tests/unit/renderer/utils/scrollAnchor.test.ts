import {
  AGENT_DISCLOSURE_SETTLED_EVENT,
  AGENT_DISCLOSURE_START_EVENT,
  calculateStreamingScrollPlan,
  captureViewportAnchor,
} from "@/renderer/utils/scrollAnchor";

describe("calculateStreamingScrollPlan", () => {
  it("follows expanded thinking and tool growth", () => {
    expect(calculateStreamingScrollPlan(24, 0, 24)).toEqual({
      body: 0,
      process: 24,
    });
  });

  it("follows visible streaming growth without exceeding total content growth", () => {
    expect(calculateStreamingScrollPlan(24, 24, 0)).toEqual({ body: 24, process: 0 });
    expect(calculateStreamingScrollPlan(100, 40, 20)).toEqual({ body: 40, process: 20 });
    expect(calculateStreamingScrollPlan(12, 40, 20)).toEqual({ body: 0, process: 12 });
    expect(calculateStreamingScrollPlan(-20, 20, 20)).toEqual({ body: 0, process: 0 });
  });

  it("ignores layout changes outside the active streaming turn", () => {
    expect(calculateStreamingScrollPlan(24, 0, 0)).toEqual({ body: 0, process: 0 });
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
