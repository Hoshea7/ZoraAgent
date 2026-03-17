import { atom } from "jotai";
import type { ProviderConfig } from "../../shared/types/provider";

export const providersAtom = atom<ProviderConfig[]>([]);

export const activeProviderAtom = atom<ProviderConfig | null>((get) => {
  return get(providersAtom).find((provider) => provider.isDefault) ?? null;
});

export const loadProvidersAtom = atom(null, async (_get, set) => {
  const providers = await window.zora.listProviders();
  set(providersAtom, providers);
});
