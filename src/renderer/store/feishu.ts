import { atom } from "jotai";
import type { FeishuBridgeStatus, FeishuConfig } from "../../shared/types/feishu";

export const feishuConfigAtom = atom<FeishuConfig | null>(null);

export const feishuBridgeStatusAtom = atom<FeishuBridgeStatus>({
  status: "stopped",
  error: null,
  botName: null,
});

export const feishuStatusAtom = atom<FeishuBridgeStatus["status"]>((get) => {
  return get(feishuBridgeStatusAtom).status;
});
