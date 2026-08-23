import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { AgentSettingsSelector } from "@/renderer/components/chat/AgentSettingsSelector";
import { providersAtom } from "@/renderer/store/provider";
import {
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  workspaceSessionsAtom,
} from "@/renderer/store/workspace";
import type { ProviderConfig } from "@/shared/types/provider";

const provider: ProviderConfig = {
  id: "provider-1",
  name: "Test Provider",
  providerType: "anthropic",
  baseUrl: "https://example.com",
  apiKey: "test",
  models: [{ id: "glm-5.2", enabled: true }],
  enabled: true,
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

  it("lets a locked history session replace an unavailable model across Providers", async () => {
    const store = createStore();
    const replacementProvider: ProviderConfig = {
      ...provider,
      id: "provider-2",
      name: "Replacement Provider",
      models: [{ id: "replacement-model", enabled: true }],
    };
    store.set(providersAtom, [
      {
        ...provider,
        models: [{ id: "disabled-model", enabled: false }],
      },
      replacementProvider,
    ]);
    store.set(currentWorkspaceIdAtom, "default");
    store.set(workspaceSessionsAtom, {
      default: [
        {
          id: "session-1",
          title: "History",
          createdAt: "2026-08-23T00:00:00.000Z",
          updatedAt: "2026-08-23T00:00:00.000Z",
          providerId: provider.id,
          providerLocked: true,
          selectedModelId: "disabled-model",
          permissionMode: "ask",
          agentRuntimeType: "pi",
        },
      ],
    });
    store.set(currentSessionIdAtom, "session-1");

    render(
      <Provider store={store}>
        <AgentSettingsSelector onOpenProviderSettings={vi.fn()} />
      </Provider>
    );

    const trigger = screen.getByRole("button", {
      name: "切换模型与推理强度",
    });
    expect(trigger).toHaveTextContent("模型不可用");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(
      await screen.findByText("当前模型不可用，请选择其他模型。")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "选择模型" }));
    fireEvent.click(await screen.findByText("replacement-model"));

    await waitFor(() =>
      expect(window.zora.switchSessionModel).toHaveBeenCalledWith(
        "session-1",
        "provider-2",
        "replacement-model",
        "default",
        expect.objectContaining({
          provider: "Replacement Provider",
          model: "replacement-model",
        })
      )
    );
  });
});
