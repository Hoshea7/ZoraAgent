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
});
