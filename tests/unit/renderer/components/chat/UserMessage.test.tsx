import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UserMessage } from "@/renderer/components/chat/UserMessage";
import {
  AGENT_DISCLOSURE_SETTLED_EVENT,
  AGENT_DISCLOSURE_START_EVENT,
} from "@/renderer/utils/scrollAnchor";

describe("UserMessage revision", () => {
  it("keeps the user comment visually stronger than the quoted response", () => {
    render(
      <UserMessage
        message={{
          id: "user-with-annotation",
          role: "user",
          text: "整体看下",
          timestamp: 1,
          responseAnnotations: [
            {
              id: "annotation-1",
              sourceMessageId: "assistant-1",
              anchor: {
                selectedText: "实验期间留在飞书的 8 个对照文档还在",
                startOffset: 0,
                endOffset: 20,
                prefix: "",
                suffix: "",
              },
              comment: "这个是什么？有必要的吗？",
              createdAt: 1,
            },
          ],
        }}
      />
    );

    fireEvent.click(screen.getByText("1 条批注"));

    expect(screen.getByTestId("sent-response-annotation-quote")).toHaveClass(
      "text-stone-500"
    );
    expect(screen.getByTestId("sent-response-annotation-comment")).toHaveClass(
      "text-[#332f2a]"
    );
  });

  it("keeps the annotation summary anchored while its details expand", () => {
    const animationFrames: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      });
    render(
      <div data-message-scroll-container="true">
        <UserMessage
          message={{
            id: "user-with-annotation",
            role: "user",
            text: "整体看下",
            timestamp: 1,
            responseAnnotations: [
              {
                id: "annotation-1",
                sourceMessageId: "assistant-1",
                anchor: {
                  selectedText: "引用内容",
                  startOffset: 0,
                  endOffset: 4,
                },
                comment: "批注内容",
                createdAt: 1,
              },
            ],
          }}
        />
      </div>
    );

    const viewport = document.querySelector(
      "[data-message-scroll-container='true']"
    ) as HTMLElement;
    const summary = screen.getByText("1 条批注").closest("summary")!;
    let scrollTop = 200;
    let summaryTop = 320;
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    vi.spyOn(summary, "getBoundingClientRect").mockImplementation(
      () => ({ top: summaryTop }) as DOMRect
    );
    const onStart = vi.fn();
    const onSettled = vi.fn();
    viewport.addEventListener(AGENT_DISCLOSURE_START_EVENT, onStart);
    viewport.addEventListener(AGENT_DISCLOSURE_SETTLED_EVENT, onSettled);

    fireEvent.click(summary);
    expect(onStart).toHaveBeenCalledOnce();
    expect(animationFrames).toHaveLength(1);

    scrollTop = 280;
    summaryTop = 240;
    act(() => animationFrames.shift()?.(0));

    expect(scrollTop).toBe(200);
    expect(onSettled).toHaveBeenCalledOnce();
    requestAnimationFrame.mockRestore();
  });

  it("opens an inline editor and resends the revised text", async () => {
    const onResend = vi.fn().mockResolvedValue(undefined);
    const onStartEdit = vi.fn();
    const onCancelEdit = vi.fn();
    const message = {
      id: "user-1",
      role: "user" as const,
      text: "Old query",
      timestamp: 1,
    };
    const sharedSurfaceClasses = [
      "rounded-[24px]",
      "rounded-tr-[8px]",
      "bg-[#f0e8dc]",
      "px-4",
      "py-3",
      "shadow-sm",
    ];

    const view = render(
      <UserMessage
        message={message}
        canEdit
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onResend={onResend}
      />
    );
    expect(screen.getByText("Old query").parentElement).toHaveClass(
      ...sharedSurfaceClasses
    );
    fireEvent.click(screen.getByRole("button", { name: "修改消息" }));
    expect(onStartEdit).toHaveBeenCalledOnce();

    view.rerender(
      <UserMessage
        message={message}
        canEdit
        isEditing
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onResend={onResend}
      />
    );
    const editor = screen.getByRole("textbox", { name: "编辑消息" });
    expect(editor.parentElement).toHaveClass(...sharedSurfaceClasses);
    expect(editor).toHaveAttribute("rows", "1");
    expect(editor).toHaveClass("resize-none");
    expect(
      screen.getByText("编辑并重新运行会删除此后的会话记录；已执行的文件修改和外部操作不会撤销。")
    ).toBeVisible();
    fireEvent.change(editor, { target: { value: "Revised query" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(onResend).toHaveBeenCalledWith("user-1", "Revised query");
    });
  });

  it("keeps resend disabled for an empty text-only message", () => {
    render(
      <UserMessage
        message={{ id: "user-1", role: "user", text: "Old query", timestamp: 1 }}
        isEditing
        onResend={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "编辑消息" }), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("keeps the edited draft and error visible when persisted messages reload", async () => {
    const onResend = vi.fn().mockRejectedValue(new Error("重新发送失败"));
    const originalMessage = {
      id: "user-1",
      role: "user" as const,
      text: "Old query",
      timestamp: 1,
    };
    const view = render(
      <UserMessage
        message={originalMessage}
        isEditing
        onResend={onResend}
      />
    );
    const editor = screen.getByRole("textbox", { name: "编辑消息" });
    fireEvent.change(editor, { target: { value: "Revised query" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    view.rerender(
      <UserMessage
        message={{ ...originalMessage, text: "Optimistic revision" }}
        isEditing
        onResend={onResend}
      />
    );
    view.rerender(
      <UserMessage
        message={originalMessage}
        isEditing
        onResend={onResend}
      />
    );

    await expect(screen.findByRole("alert")).resolves.toHaveTextContent(
      "重新发送失败"
    );
    expect(editor).toHaveValue("Revised query");
  });
});
