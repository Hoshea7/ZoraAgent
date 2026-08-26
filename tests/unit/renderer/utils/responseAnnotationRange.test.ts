import {
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
