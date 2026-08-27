import { fireEvent, render, screen } from "@testing-library/react";
import { ToolStep } from "@/renderer/components/chat/ToolStep";

describe("ToolStep", () => {
  it("uses a non-underlined keyboard focus treatment", () => {
    render(
      <ToolStep
        tool={{
          id: "tool-focus",
          name: "Bash",
          input: "{}",
          status: "running",
          startedAt: 1,
        }}
      />
    );

    const toggle = screen.getByRole("button", { name: /Bash/ });
    expect(toggle).not.toHaveClass("focus-visible:underline");
    expect(toggle).toHaveClass("focus-visible:ring-1");
  });

  it("does not expose an absolute Read path in Agent Trace", () => {
    render(
      <ToolStep
        tool={{
          id: "tool-1",
          name: "Read",
          input: JSON.stringify({ file_path: "/Users/example/.zora/private/image.png" }),
          status: "done",
          startedAt: 1,
          completedAt: 2,
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Read/ }));
    expect(screen.getByText(/image\.png/)).toBeInTheDocument();
    expect(screen.queryByText(/Users\/example/)).not.toBeInTheDocument();
  });

  it("lets long tool output expand without an inner scroll region", () => {
    render(
      <ToolStep
        tool={{
          id: "tool-2",
          name: "Bash",
          input: "{}",
          result: "output\n".repeat(80),
          status: "done",
          startedAt: 1,
          completedAt: 2,
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Bash/ }));
    const output = screen.getByTestId("tool-output");
    expect(output).not.toHaveClass("max-h-40", "overflow-y-auto", "custom-scrollbar");
    expect(output.closest(".ai-disclosure")).toHaveAttribute(
      "data-disclosure-state",
      "open"
    );
  });

  it("keeps the expanded tool detail mounted while tool input streams", () => {
    const createTool = (input: string) => ({
      id: "tool-streaming",
      name: "Bash",
      input,
      status: "running" as const,
      startedAt: 1,
    });
    const { rerender } = render(<ToolStep tool={createTool("{")} />);
    fireEvent.click(screen.getByRole("button", { name: /Bash/ }));
    const detail = document.querySelector(".ai-process-mono");
    expect(detail).not.toBeNull();

    for (let index = 1; index <= 30; index += 1) {
      rerender(<ToolStep tool={createTool(`{\"command\":\"步骤 ${index}`)} />);
      expect(document.querySelector(".ai-process-mono")).toBe(detail);
      expect(screen.getByRole("button", { name: /Bash/ })).toHaveAttribute(
        "aria-expanded",
        "true"
      );
    }
  });
});
