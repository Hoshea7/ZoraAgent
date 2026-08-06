import { render, screen } from "@testing-library/react";
import {
  getProviderInitial,
  getProviderModelCountLabel,
  ProviderIcon,
  ProviderRuntimeChips,
} from "@/renderer/components/settings/ProviderPresentation";
import type { ProviderConfig } from "@/shared/types/provider";

function createProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider-1",
    name: "Agent Plan",
    providerType: "volcengine",
    presetId: "volcengine-agent-plan-openai",
    protocol: "openai-completions",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    apiKey: "masked",
    modelId: "glm-5.2",
    roleModels: { haikuModel: "glm-5.2-fast" },
    enabled: true,
    isDefault: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("ProviderPresentation", () => {
  it("shows only Pi for an OpenAI protocol provider", () => {
    render(<ProviderRuntimeChips provider={createProvider()} />);

    expect(screen.getByText("Pi")).toBeInTheDocument();
    expect(screen.queryByText("Claude")).not.toBeInTheDocument();
  });

  it("shows Claude and Pi for an Anthropic protocol provider", () => {
    render(
      <ProviderRuntimeChips
        provider={createProvider({
          presetId: "volcengine-agent-plan-anthropic",
          protocol: "anthropic-messages",
          baseUrl: "https://ark.cn-beijing.volces.com/api/plan",
        })}
      />
    );

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Pi")).toBeInTheDocument();
  });

  it("uses the copied provider logo and counts configured models", () => {
    const provider = createProvider();
    render(<ProviderIcon provider={provider} />);

    expect(screen.getByRole("img", { name: "火山引擎 图标" })).toBeInTheDocument();
    expect(getProviderModelCountLabel(provider)).toBe("2 个模型");
  });

  it("uses the first character for an unrecognized custom provider", () => {
    const provider = createProvider({
      name: "mira",
      providerType: "custom",
      presetId: "custom",
      baseUrl: "http://localhost:8819",
    });
    render(<ProviderIcon provider={provider} />);

    expect(screen.getByRole("img", { name: "mira 图标" })).toHaveTextContent("M");
    expect(getProviderInitial("记忆服务")).toBe("记");
  });

  it("recognizes a branded logo from a custom provider URL", () => {
    render(
      <ProviderIcon
        provider={createProvider({
          name: "deepseek",
          providerType: "custom",
          presetId: "custom",
          baseUrl: "https://api.deepseek.com/anthropic",
        })}
      />
    );

    expect(screen.getByRole("img", { name: "DeepSeek 图标" })).toBeInTheDocument();
  });
});
