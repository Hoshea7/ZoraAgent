import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { ProviderSettings } from "@/renderer/components/settings/ProviderSettings";
import { defaultModelSettingsAtom } from "@/renderer/store/default-model";
import { providersAtom } from "@/renderer/store/provider";
import type { ProviderConfig } from "@/shared/types/provider";

const provider: ProviderConfig = {
  id: "provider-1",
  name: "工作模型",
  providerType: "anthropic",
  baseUrl: "https://example.com",
  apiKey: "••••••",
  models: [{ id: "model-a", enabled: true }],
  presetId: "anthropic",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  protocol: "anthropic-messages",
};

function renderSettings(configuredProvider = provider) {
  const store = createStore();
  store.set(providersAtom, [configuredProvider]);
  store.set(defaultModelSettingsAtom, {
    defaultProviderId: null,
    defaultModelId: null,
  });
  vi.mocked(window.zora.defaultModel.getSettings).mockResolvedValue({
    defaultProviderId: null,
    defaultModelId: null,
  });
  vi.mocked(window.zora.vision.getSettings).mockResolvedValue({
    relay: { enabled: false },
    capabilityOverrides: [],
  });
  render(
    <Provider store={store}>
      <ProviderSettings />
    </Provider>
  );
}

describe("ProviderSettings", () => {
  it("rejects a duplicate manual model without calling the main process", async () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "编辑 工作模型" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑模型配置" });
    fireEvent.change(within(dialog).getByPlaceholderText("模型 ID"), {
      target: { value: "model-a" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加" }));

    expect(within(dialog).getByText("模型已存在。")).toBeVisible();
    expect(window.zora.updateProvider).not.toHaveBeenCalled();
  });

  it("uses a short confirmation when the Provider is not in use", async () => {
    vi.mocked(window.zora.getProviderReferenceImpact).mockResolvedValue({
      inUse: false,
    });
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "删除 工作模型" }));
    const dialog = await screen.findByRole("dialog", { name: "删除模型配置" });

    expect(dialog).toHaveTextContent("确认删除“工作模型”吗？");
    expect(dialog).not.toHaveTextContent("删除后需要重新配置模型");
    expect(window.zora.deleteProvider).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(window.zora.deleteProvider).toHaveBeenCalledWith("provider-1")
    );
  });

  it("adds one product-level impact sentence when the Provider is in use", async () => {
    vi.mocked(window.zora.getProviderReferenceImpact).mockResolvedValue({
      inUse: true,
    });
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "删除 工作模型" }));
    const dialog = await screen.findByRole("dialog", { name: "删除模型配置" });

    expect(dialog).toHaveTextContent(
      "该 Provider 下有模型正在使用，删除后需要重新配置模型。"
    );
  });

  it("uses the same product-level wording for an in-use model", async () => {
    vi.mocked(window.zora.getProviderReferenceImpact).mockResolvedValue({
      inUse: true,
    });
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "编辑 工作模型" }));
    const editDialog = await screen.findByRole("dialog", {
      name: "编辑模型配置",
    });
    fireEvent.click(
      within(editDialog).getByRole("button", { name: "删除模型 model-a" })
    );
    const deleteDialog = await screen.findByRole("dialog", { name: "删除模型" });

    expect(deleteDialog.parentElement).toHaveClass("z-[180]");
    expect(window.zora.getProviderReferenceImpact).toHaveBeenCalledWith(
      "provider-1",
      "model-a"
    );
    expect(deleteDialog).toHaveTextContent(
      "该模型正在使用，删除后需要重新配置模型。"
    );
  });

  it("does not offer connection testing for a disabled Provider", async () => {
    renderSettings({ ...provider, enabled: false });

    fireEvent.click(screen.getByRole("button", { name: "编辑 工作模型" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑模型配置" });
    expect(
      within(dialog).getByRole("button", { name: "测试连接" })
    ).toBeDisabled();
  });
});
