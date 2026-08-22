type ProviderErrorPayload = {
  code?: unknown;
  message?: unknown;
};

function parseProviderErrorPayload(message: string): ProviderErrorPayload | null {
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const value = JSON.parse(message.slice(jsonStart)) as unknown;
    return typeof value === "object" && value !== null
      ? (value as ProviderErrorPayload)
      : null;
  } catch {
    return null;
  }
}

export function formatProviderTestError(message: string): string {
  const payload = parseProviderErrorPayload(message);
  if (payload?.code === "AccountQuotaExceeded") {
    return "本周额度已用完，请等待额度重置。";
  }

  const source = typeof payload?.message === "string" ? payload.message : message;
  const withoutRequestId = source.split(/\s*Request id:/i)[0]?.trim() ?? source.trim();
  return withoutRequestId.length > 140
    ? `${withoutRequestId.slice(0, 140)}…`
    : withoutRequestId;
}
