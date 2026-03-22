import { atom } from "jotai";
import type { McpConfig } from "../../shared/types/mcp";

export const mcpConfigAtom = atom<McpConfig>({ servers: {} });

export const loadMcpConfigAtom = atom(null, async (_get, set) => {
  const config = await window.zora.mcp.getConfig();
  set(mcpConfigAtom, config);
});

export const deleteMcpServerAtom = atom(null, async (_get, set, name: string) => {
  const config = await window.zora.mcp.deleteServer(name);
  set(mcpConfigAtom, config);
});

export const toggleMcpServerAtom = atom(
  null,
  async (_get, set, payload: { name: string; enabled: boolean }) => {
    const config = await window.zora.mcp.toggleServer(payload.name, payload.enabled);
    set(mcpConfigAtom, config);
  }
);
