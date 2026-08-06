import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MainArea } from "@/renderer/components/layout/MainArea";
import { providersAtom, providersLoadedAtom } from "@/renderer/store/provider";
import type { ProviderConfig } from "@/shared/types/provider";

const provider: ProviderConfig = {
  id: "provider-1",
  name: "OpenAI",
  providerType: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  modelId: "gpt-5-mini",
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

function renderMainArea() {
  const store = createStore();
  store.set(providersAtom, [provider]);
  store.set(providersLoadedAtom, true);
  render(
    <Provider store={store}>
      <MainArea />
    </Provider>
  );
  return store;
}

describe("MainArea runtime selection", () => {
  it("saves the default Pi runtime before sending the first query", async () => {
    vi.mocked(window.zora.createSession).mockResolvedValue({
      id: "session-1",
      title: "Hello",
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });
    window.zora.setSessionRuntime = vi.fn().mockResolvedValue(undefined);
    renderMainArea();

    fireEvent.change(screen.getByPlaceholderText(/给 Zora 发消息/), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => {
      expect(window.zora.setSessionRuntime).toHaveBeenCalledWith(
        "session-1",
        "pi",
        "default"
      );
    });
  });

  it("saves Claude when the user changes the new-conversation runtime", async () => {
    vi.mocked(window.zora.createSession).mockResolvedValue({
      id: "session-2",
      title: "Hello",
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });
    window.zora.setSessionRuntime = vi.fn().mockResolvedValue(undefined);
    renderMainArea();

    fireEvent.pointerDown(screen.getByRole("button", { name: "切换运行时" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("button", { name: /Claude/ }));
    fireEvent.change(screen.getByPlaceholderText(/给 Zora 发消息/), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => {
      expect(window.zora.setSessionRuntime).toHaveBeenCalledWith(
        "session-2",
        "claude",
        "default"
      );
    });
  });
});
