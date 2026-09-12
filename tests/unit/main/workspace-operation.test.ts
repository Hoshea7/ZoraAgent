import { useWorkspace, rebindWorkspaceExclusively } from "@/main/workspace-operation";
import { PROJECT_DIRECTORY_BUSY } from "@/shared/project-directory";

it("excludes rebinding while a startup or nested mutation is in flight", async () => {
  await useWorkspace("a", async () => {
    await useWorkspace("a", async () => {
      await expect(rebindWorkspaceExclusively("a", async () => undefined)).rejects.toThrow(PROJECT_DIRECTORY_BUSY);
    });
    await rebindWorkspaceExclusively("b", async () => undefined);
  });
  await rebindWorkspaceExclusively("a", async () => undefined);
});

it("excludes startup during rebinding and releases the exclusion on error", async () => {
  await expect(rebindWorkspaceExclusively("a", async () => {
    await expect(useWorkspace("a", async () => undefined)).rejects.toThrow(PROJECT_DIRECTORY_BUSY);
    await expect(rebindWorkspaceExclusively("a", async () => undefined)).rejects.toThrow(PROJECT_DIRECTORY_BUSY);
    throw new Error("failed write");
  })).rejects.toThrow("failed write");
  await expect(useWorkspace("a", async () => "ready")).resolves.toBe("ready");
});
