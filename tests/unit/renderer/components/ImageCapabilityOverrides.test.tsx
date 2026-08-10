import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImageCapabilityOverrides } from "@/renderer/components/settings/ImageCapabilityOverrides";
import type { ProviderConfig } from "@/shared/types/provider";

const provider: ProviderConfig = {
  id: "provider-1",
  name: "模型服务",
  providerType: "custom",
  protocol: "openai-completions",
  baseUrl: "https://example.com",
  apiKey: "masked",
  modelId: "edge-model",
  enabled: true,
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("ImageCapabilityOverrides", () => {
  it("stores a provider-specific user override", async () => {
    vi.mocked(window.zora.vision.getSettings).mockResolvedValue({
      relay: { enabled: false },
      capabilityOverrides: [],
    });
    vi.mocked(window.zora.vision.updateSettings).mockImplementation(async (value) => value);

    render(<ImageCapabilityOverrides providers={[provider]} />);
    const select = await screen.findByRole("combobox", {
      name: "模型服务 edge-model 图片能力",
    });
    fireEvent.change(select, { target: { value: "supported" } });

    await waitFor(() => {
      expect(window.zora.vision.updateSettings).toHaveBeenCalledWith({
        relay: { enabled: false },
        capabilityOverrides: [
          {
            providerId: "provider-1",
            modelId: "edge-model",
            capability: "supported",
          },
        ],
      });
    });
  });
});
