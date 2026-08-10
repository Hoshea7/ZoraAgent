import { atom } from "jotai";
import type { PermissionMode } from "../../shared/zora";

export const draftPermissionModeAtom = atom<PermissionMode>("ask");
