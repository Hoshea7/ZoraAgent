import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { AgentSettingsSelector } from "@/renderer/components/chat/AgentSettingsSelector";
import { providersAtom } from "@/renderer/store/provider";
import type { ProviderConfig } from "@/shared/types/provider";

const provider: ProviderConfig = {
  id: "provider-1",
  name: "Test Provider",
  providerType: "anthropic",
  baseUrl: "https://example.com",
  apiKey: "test",
  modelId: "glm-5.2",
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
  protocol: "anthropic-messages",
};

describe("AgentSettingsSelector", () => {
  it("combines model and reasoning while leaving runtime separate", async () => {
    const store = createStore();
    store.set(providersAtom, [provider]);
    render(
      <Provider store={store}>
        <AgentSettingsSelector onOpenProviderSettings={vi.fn()} />
      </Provider>
    );

    const trigger = screen.getByRole("button", {
      name: "切换模型与推理强度",
    });
    expect(trigger).toHaveTextContent("glm-5.2");
    expect(trigger).toHaveTextContent("高");

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(await screen.findByText("模型")).toBeInTheDocument();
    expect(screen.getByText("推理强度")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "推理强度" })).toHaveAttribute(
      "aria-valuetext",
      "高"
    );
    expect(screen.getByTestId("reasoning-slider-fill")).toHaveStyle({
      width: "50%",
    });
    expect(screen.getByTestId("reasoning-slider-thumb")).toHaveStyle({
      left: "50%",
    });
    expect(screen.queryByText("速度")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: "推理强度" }), {
      target: { value: "2" },
    });
    await waitFor(() => expect(trigger).toHaveTextContent("最大"));
    expect(screen.getByTestId("reasoning-slider-fill")).toHaveStyle({
      width: "100%",
    });
    expect(screen.getByTestId("reasoning-slider-thumb")).toHaveStyle({
      left: "calc(100% - 10px)",
    });

    fireEvent.change(screen.getByRole("slider", { name: "推理强度" }), {
      target: { value: "0" },
    });
    await waitFor(() =>
      expect(trigger).toHaveAttribute("data-reasoning-level", "off")
    );
    expect(trigger).not.toHaveTextContent("关闭");
    expect(screen.getByTestId("reasoning-slider-fill")).toHaveStyle({
      width: "0%",
    });
    expect(screen.getByTestId("reasoning-slider-thumb")).toHaveStyle({
      left: "10px",
    });
  });
});
