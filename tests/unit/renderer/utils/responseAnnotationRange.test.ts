import {
  calculateResponseAnnotationEditorPosition,
  calculateResponseAnnotationPopoverPosition,
  captureResponseSelection,
  restoreResponseAnnotationRange,
} from "../../../../src/renderer/utils/responseAnnotationRange";

describe("response annotation ranges", () => {
  it("captures and restores a selection across text nodes", () => {
    const surface = document.createElement("div");
    surface.innerHTML = "<p>第一段文字</p><p>第二段文字</p>";
    document.body.append(surface);
    const first = surface.querySelectorAll("p")[0].firstChild as Text;
    const second = surface.querySelectorAll("p")[1].firstChild as Text;
    const range = document.createRange();
    range.setStart(first, 2);
    range.setEnd(second, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const captured = captureResponseSelection(surface, "assistant-1", selection);

    expect(captured?.anchor).toEqual({
      startOffset: 2,
      endOffset: 8,
      selectedText: "段文字第二段",
    });
    expect(
      restoreResponseAnnotationRange(surface, captured!.anchor)?.toString()
    ).toBe("段文字第二段");
  });

  it("ignores empty, external, and excluded selections", () => {
    const surface = document.createElement("div");
    surface.innerHTML = '<p>正文</p><button type="button">复制</button>';
    const outside = document.createTextNode("外部");
    document.body.append(surface, outside);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(outside);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(captureResponseSelection(surface, "assistant-1", selection)).toBeNull();

    const buttonText = surface.querySelector("button")!.firstChild!;
    range.selectNodeContents(buttonText);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(captureResponseSelection(surface, "assistant-1", selection)).toBeNull();
  });

  it("marks changed content as unavailable", () => {
    const surface = document.createElement("div");
    surface.textContent = "原始正文";
    document.body.append(surface);

    expect(
      restoreResponseAnnotationRange(surface, {
        startOffset: 0,
        endOffset: 2,
        selectedText: "其他",
      })
    ).toBeNull();
  });
});

describe("response annotation popover placement", () => {
  it("centers a short selection and places the card above it", () => {
    expect(
      calculateResponseAnnotationPopoverPosition(
        [{ left: 300, right: 420, top: 240, bottom: 264, width: 120, height: 24 }],
        { width: 116, height: 36 },
        { width: 1000, height: 700 }
      )
    ).toEqual({ left: 302, top: 194, side: "top" });
  });

  it("places the comment editor at the upper-right of the selection", () => {
    expect(
      calculateResponseAnnotationEditorPosition(
        [{ left: 240, right: 420, top: 300, bottom: 324, width: 180, height: 24 }],
        { width: 312, height: 88 },
        { width: 1200, height: 800 }
      )
    ).toEqual({ left: 432, top: 200, side: "right" });
  });

  it("keeps the comment editor on the right at the viewport edge", () => {
    expect(
      calculateResponseAnnotationEditorPosition(
        [{ left: 760, right: 940, top: 300, bottom: 324, width: 180, height: 24 }],
        { width: 312, height: 88 },
        { width: 1000, height: 800 }
      )
    ).toEqual({ left: 676, top: 200, side: "right" });
  });

  it("biases a long selection toward its end while staying in the viewport", () => {
    const position = calculateResponseAnnotationPopoverPosition(
      [
        { left: 120, right: 760, top: 260, bottom: 284, width: 640, height: 24 },
        { left: 120, right: 540, top: 292, bottom: 316, width: 420, height: 24 },
      ],
      { width: 116, height: 36 },
      { width: 1000, height: 700 }
    );

    expect(position.side).toBe("top");
    expect(position.left).toBeGreaterThan((120 + 760) / 2 - 58);
    expect(position.top).toBe(214);
  });

  it("falls below the selection when the top edge has no room", () => {
    expect(
      calculateResponseAnnotationPopoverPosition(
        [{ left: 20, right: 120, top: 18, bottom: 42, width: 100, height: 24 }],
        { width: 116, height: 36 },
        { width: 500, height: 400 }
      )
    ).toEqual({ left: 12, top: 52, side: "bottom" });
  });
});
