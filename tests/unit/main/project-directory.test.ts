import path from "node:path";
import { stat, access } from "node:fs/promises";
import { isDirectoryAvailable, requireDirectory, rebindDirectory } from "@/main/project-directory";
import { PROJECT_DIRECTORY_UNAVAILABLE } from "@/shared/project-directory";

vi.mock("node:fs/promises", () => ({ stat: vi.fn(), access: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });

it("checks availability without creating or writing any files", async () => {
  vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as Awaited<ReturnType<typeof stat>>);
  vi.mocked(access).mockResolvedValue(undefined);
  expect(await requireDirectory("/project")).toBe("/project");
  expect(await isDirectoryAvailable(undefined)).toBe(false);
});

it.each(["ENOENT", "EACCES", "EPERM", "EIO"])("treats %s as the same unavailable state", async (code) => {
  vi.mocked(stat).mockRejectedValue(Object.assign(new Error(code), { code }));
  expect(await isDirectoryAvailable("/project")).toBe(false);
  await expect(requireDirectory("/project")).rejects.toThrow(PROJECT_DIRECTORY_UNAVAILABLE);
});

it("requires a directory and usable access", async () => {
  vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as Awaited<ReturnType<typeof stat>>);
  expect(await isDirectoryAvailable("/file")).toBe(false);
  vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as Awaited<ReturnType<typeof stat>>);
  vi.mocked(access).mockRejectedValue(new Error("unavailable"));
  expect(await isDirectoryAvailable("/project")).toBe(false);
});

it("maps root and descendants without touching independent or prefix-matching paths", () => {
  const oldRoot = path.resolve("/old/project");
  const newRoot = path.resolve("/new/project");
  expect(rebindDirectory(oldRoot, oldRoot, newRoot)).toBe(newRoot);
  expect(rebindDirectory(path.join(oldRoot, "src"), oldRoot, newRoot)).toBe(path.join(newRoot, "src"));
  expect(rebindDirectory(`${oldRoot}-other`, oldRoot, newRoot)).toBe(`${oldRoot}-other`);
  expect(rebindDirectory("/independent", oldRoot, newRoot)).toBe("/independent");
  expect(rebindDirectory(undefined, oldRoot, newRoot)).toBeUndefined();
});
