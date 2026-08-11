import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { VisionSettings } from "@/renderer/components/settings/VisionSettings";
import { providersAtom } from "@/renderer/store/provider";
import type { ProviderConfig } from "@/shared/types/provider";
import type { VisionSettings as VisionSettingsValue } from "@/shared/types/vision";

function createProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider-1",
    name: "火山方舟 Coding Plan",
    providerType: "volcengine",
    protocol: "openai-completions",
    baseUrl: "https://example.com",
    apiKey: "masked",
    modelId: "private-vision-model",
    roleModels: { haikuModel: "private-fast-model" },
    enabled: true,
    isDefault: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function renderSettings(
  providers = [createProvider()],
  settings: VisionSettingsValue = {
    relay: { enabled: false },
    capabilityOverrides: [],
  }
) {
  const store = createStore();
  store.set(providersAtom, providers);
  vi.mocked(window.zora.listProviders).mockResolvedValue(providers);
  vi.mocked(window.zora.vision.getSettings).mockResolvedValue(settings);
  vi.mocked(window.zora.vision.updateSettings).mockImplementation(async (settings) => settings);

  render(
    <Provider store={store}>
      <VisionSettings />
    </Provider>
  );
}

describe("VisionSettings", () => {
  it("does not animate the toggle while persisted settings hydrate", async () => {
    renderSettings([createProvider()], {
      relay: {
        enabled: true,
        providerId: "provider-1",
        modelId: "private-vision-model",
      },
      capabilityOverrides: [],
    });

    const toggle = await screen.findByRole("switch", { name: "启用视觉中转" });

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).not.toHaveClass("transition-colors");
    expect(toggle.firstElementChild).not.toHaveClass("transition-transform");
  });

  it("can enable relay with the first configured model", async () => {
    renderSettings();

    const toggle = await screen.findByRole("switch", { name: "启用视觉中转" });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(window.zora.vision.updateSettings).toHaveBeenCalledWith({
        relay: {
          enabled: true,
          providerId: "provider-1",
          modelId: "private-vision-model",
        },
        capabilityOverrides: [],
      });
    });
  });

  it("shows configured models without manual capability fields or implementation limits", async () => {
    renderSettings();

    expect(await screen.findByText("启用视觉中转")).toBeInTheDocument();
    expect(screen.getByText("选择视觉模型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择视觉模型" })).toHaveTextContent(
      "火山方舟 Coding Plan · private-vision-model"
    );
    expect(screen.queryByText("模型能力覆盖")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Provider ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Model ID")).not.toBeInTheDocument();
    expect(screen.queryByText(/10MB|2000 万|1000 字符/)).not.toBeInTheDocument();
  });

  it("offers configured models even when their image capability is unconfirmed", async () => {
    renderSettings([createProvider()]);

    const toggle = await screen.findByRole("switch", { name: "启用视觉中转" });
    expect(toggle).toBeEnabled();
    expect(screen.getByRole("button", { name: "选择视觉模型" })).toHaveTextContent(
      "火山方舟 Coding Plan · private-vision-model"
    );

    const trigger = screen.getByRole("button", { name: "选择视觉模型" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: /private-fast-model/ })).toBeVisible();
  });

  it("selects another model from the configured Provider models", async () => {
    renderSettings();

    const trigger = await screen.findByRole("button", { name: "选择视觉模型" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: /private-fast-model/ }));

    await waitFor(() => {
      expect(window.zora.vision.updateSettings).toHaveBeenCalledWith({
        relay: {
          enabled: true,
          providerId: "provider-1",
          modelId: "private-fast-model",
        },
        capabilityOverrides: [],
      });
    });
  });
});
