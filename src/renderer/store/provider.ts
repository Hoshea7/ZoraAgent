import { atom } from "jotai";
import type { ProviderConfig } from "../../shared/types/provider";

export const providersAtom = atom<ProviderConfig[]>([]);
export const providersLoadedAtom = atom(false);

export const activeProviderAtom = atom<ProviderConfig | null>((get) => {
  return (
    get(providersAtom).find((provider) => provider.enabled) ??
    null
  );
});

export const loadProvidersAtom = atom(null, async (_get, set) => {
  try {
    const providers = await window.zora.listProviders();
    set(providersAtom, providers);
    return providers;
  } finally {
    set(providersLoadedAtom, true);
  }
});
