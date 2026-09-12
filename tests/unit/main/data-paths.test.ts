import path from "node:path";
import { getDataFilePath } from "@/main/data-paths";
vi.mock("@/main/utils/fs", () => ({ ZORA_DIR: "/current-device/.zora" }));

it("resolves configuration and state under the current data root", () => {
  expect(getDataFilePath("providers.json")).toBe(path.join("/current-device/.zora", "config", "providers.json"));
  expect(getDataFilePath("skill-registry.json")).toBe(path.join("/current-device/.zora", "state", "skill-registry.json"));
});
