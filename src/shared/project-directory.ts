export const PROJECT_DIRECTORY_UNAVAILABLE = "该项目文件夹已被删除或移动";
export const PROJECT_DIRECTORY_BUSY = "项目正在运行或处理操作，请结束后再编辑项目";

export function isProjectDirectoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(PROJECT_DIRECTORY_UNAVAILABLE) || message.includes(PROJECT_DIRECTORY_BUSY);
}
