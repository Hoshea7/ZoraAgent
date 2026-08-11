import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { RuntimeSelector } from "@/renderer/components/chat/RuntimeSelector";
import { providersAtom } from "@/renderer/store/provider";
import {
  currentSessionIdAtom,
  currentWorkspaceIdAtom,
  draftAgentRuntimeTypeAtom,
  workspaceSessionsAtom,
} from "@/renderer/store/workspace";
import type { ProviderConfig } from "@/shared/types/provider";

function createProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
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
    protocol: "openai-completions",
    ...overrides,
  };
}

function renderSelector(provider = createProvider()) {
  const store = createStore();
  store.set(providersAtom, [provider]);
  render(
    <Provider store={store}>
      <RuntimeSelector />
    </Provider>
  );
  return store;
}

async function openRuntimeMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "切换运行时" }), {
    button: 0,
    ctrlKey: false,
  });
}

describe("RuntimeSelector", () => {
  it("shows Pi as the default runtime for a new conversation", () => {
    renderSelector();

    expect(screen.getByRole("button", { name: "切换运行时" })).toHaveTextContent(
      "Pi"
    );
  });

  it("keeps a Claude selection on the new-conversation draft", async () => {
    renderSelector(createProvider({ protocol: "anthropic-messages" }));

    await openRuntimeMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Claude/ }));

    expect(screen.getByRole("button", { name: "切换运行时" })).toHaveTextContent(
      "Claude"
    );
  });

  it("disables Claude for an OpenAI protocol provider", async () => {
    renderSelector();

    await openRuntimeMenu();

    expect(
      await screen.findByRole("menuitem", { name: /Claude.*不支持/ })
    ).toHaveAttribute("data-disabled");
  });

  it("uses Pi for a legacy session without a saved runtime", () => {
    const store = createStore();
    store.set(providersAtom, [createProvider()]);
    store.set(currentWorkspaceIdAtom, "default");
    store.set(draftAgentRuntimeTypeAtom, "claude");
    store.set(workspaceSessionsAtom, {
      default: [
        {
          id: "legacy-session",
          title: "Legacy",
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
        },
      ],
    });
    store.set(currentSessionIdAtom, "legacy-session");
    render(
      <Provider store={store}>
        <RuntimeSelector />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "切换运行时" })).toHaveTextContent(
      "Pi"
    );
  });

  it("switches an existing session runtime without locking the selector", async () => {
    const provider = createProvider({ protocol: "anthropic-messages" });
    const store = createStore();
    store.set(providersAtom, [provider]);
    store.set(currentWorkspaceIdAtom, "default");
    store.set(workspaceSessionsAtom, {
      default: [
        {
          id: "session-1",
          title: "Existing",
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
          providerId: provider.id,
          providerLocked: true,
          agentRuntimeType: "pi",
        },
      ],
    });
    store.set(currentSessionIdAtom, "session-1");
    render(
      <Provider store={store}>
        <RuntimeSelector />
      </Provider>
    );

    const selector = screen.getByRole("button", { name: "切换运行时" });
    expect(selector).toBeEnabled();
    await openRuntimeMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Claude/ }));

    await waitFor(() => {
      expect(window.zora.setSessionRuntime).toHaveBeenCalledWith(
        "session-1",
        "claude",
        "default"
      );
      expect(selector).toHaveTextContent("Claude");
    });
  });
});
