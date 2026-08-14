import { fireEvent, render, screen } from "@testing-library/react";
import { ToolStep } from "@/renderer/components/chat/ToolStep";

describe("ToolStep", () => {
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
    expect(document.querySelector(".transition-\\[grid-template-rows\\,opacity\\]")).toBeNull();
  });
});
