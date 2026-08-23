import type { ProviderConfig, ProviderType, AgentRuntimeType } from "../../../shared/types/provider";
import { getCompatibleAgentRuntimes } from "../../../shared/runtime-capabilities";
import { getProviderModels } from "../../utils/provider-selection";
import { cn } from "../../utils/cn";
import anthropicLogo from "../../assets/providers/claude.png";
import volcengineLogo from "../../assets/providers/doubao.png";
import deepseekLogo from "../../assets/providers/deepseek.png";
import zhipuLogo from "../../assets/providers/zhipu.png";
import moonshotLogo from "../../assets/providers/moonshot.png";
import openaiLogo from "../../assets/providers/openai.png";

const RUNTIME_LABELS: Record<AgentRuntimeType, string> = {
  claude: "Claude",
  pi: "Pi",
};

interface ProviderLogoMatch {
  label: string;
  src: string;
}

const PROVIDER_LOGOS: Partial<Record<ProviderType, ProviderLogoMatch>> = {
  anthropic: { label: "Anthropic", src: anthropicLogo },
  volcengine: { label: "火山引擎", src: volcengineLogo },
  zhipu: { label: "智谱 AI", src: zhipuLogo },
  moonshot: { label: "Kimi", src: moonshotLogo },
  deepseek: { label: "DeepSeek", src: deepseekLogo },
  openai: { label: "OpenAI", src: openaiLogo },
};

const CUSTOM_URL_LOGOS: Array<[RegExp, ProviderLogoMatch]> = [
  [/volces\.com|volcengine/i, { label: "火山引擎", src: volcengineLogo }],
  [/deepseek/i, { label: "DeepSeek", src: deepseekLogo }],
  [/bigmodel\.cn|zhipuai/i, { label: "智谱 AI", src: zhipuLogo }],
  [/moonshot\.cn|kimi/i, { label: "Kimi", src: moonshotLogo }],
  [/openai\.com/i, { label: "OpenAI", src: openaiLogo }],
];

function resolveProviderLogo(provider: ProviderConfig): ProviderLogoMatch | null {
  if (provider.providerType !== "custom") {
    return PROVIDER_LOGOS[provider.providerType] ?? null;
  }

  return (
    CUSTOM_URL_LOGOS.find(([pattern]) => pattern.test(provider.baseUrl))?.[1] ??
    null
  );
}

export function getProviderInitial(name: string): string {
  const initial = Array.from(name.trim())[0] ?? "?";
  return /^[a-z]$/i.test(initial) ? initial.toUpperCase() : initial;
}

export function ProviderIcon({
  provider,
  className,
}: {
  provider: ProviderConfig;
  className?: string;
}) {
  const logo = resolveProviderLogo(provider);
  const baseClassName = cn(
    "inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg",
    className
  );

  if (logo) {
    return (
      <img
        src={logo.src}
        alt={`${logo.label} 图标`}
        className={cn(baseClassName, "object-cover")}
      />
    );
  }

  return (
    <span
      className={cn(
        baseClassName,
        "bg-stone-100 text-[13px] font-semibold text-stone-600 ring-1 ring-inset ring-stone-200"
      )}
      role="img"
      aria-label={`${provider.name} 图标`}
    >
      {getProviderInitial(provider.name)}
    </span>
  );
}

export function ProviderRuntimeChips({ provider }: { provider: ProviderConfig }) {
  const runtimes = getCompatibleAgentRuntimes(provider.protocol);

  return (
    <span className="inline-flex items-center gap-1" aria-label="支持的 Runtime">
      {runtimes.map((agentRuntimeType) => (
        <span
          key={agentRuntimeType}
          className="inline-flex h-5 items-center rounded-full border border-stone-200 bg-white px-2 text-[10px] font-medium leading-none text-stone-600"
          title={`${RUNTIME_LABELS[agentRuntimeType]} Runtime`}
        >
          {RUNTIME_LABELS[agentRuntimeType]}
        </span>
      ))}
    </span>
  );
}

export function getProviderModelCountLabel(provider: ProviderConfig): string {
  return `${getProviderModels(provider).length} 个模型`;
}
