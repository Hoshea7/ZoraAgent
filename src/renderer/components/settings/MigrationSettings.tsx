import { useEffect, useState } from "react";
import { FolderOpen, Copy } from "lucide-react";
import { getErrorMessage } from "../../utils/message";

export function MigrationSettings() {
  const [directory, setDirectory] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let cancelled = false;
    void window.zora.getMigrationDataDirectory().then((value) => {
      if (!cancelled) setDirectory(value);
    }).catch((error) => { if (!cancelled) setNotice(getErrorMessage(error)); });
    return () => { cancelled = true; };
  }, []);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(`请帮我准备将 Zora 数据迁移到新设备。当前数据目录是 ${directory}。

确认实际目录，将完整 .zora 复制或压缩到数据目录之外，保留原数据。建议当前任务结束后打包。
告诉我生成位置，并引导我把目录或压缩包传到新设备；外部项目文件另行携带。
新设备恢复时，先检查副本中的会话正文、附件及索引，说明目标数据目录、将覆盖的文件并与我确认，保留目标原数据备份。
已知旧格式由新版 Zora 的数据升级处理。保留 Pi 原生会话文件、历史正文和记忆，按实际可用性加载技能。
核对项目在新设备的本地目录，让我选择对应目录或跳过。完成后检查旧会话和附件，并让原会话读取新目录中的文件、继续之前的问题。`);
      setNotice("准备迁移提示词已复制");
    } catch (error) { setNotice(getErrorMessage(error)); }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-stone-900">数据迁移</h2>
        <p className="mt-2 text-sm leading-6 text-stone-500">将工作数据带到新设备，再关联本机项目文件夹。</p>
      </div>
      <section className="space-y-3">
        <h3 className="text-sm font-medium">当前数据目录</h3>
        <p className="break-all rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-600">{directory || "读取中…"}</p>
        <div className="flex flex-wrap gap-3">
          <button className="inline-flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm hover:bg-stone-50" onClick={() => {
            void window.zora.openMigrationDataDirectory().catch((error) => setNotice(getErrorMessage(error)));
          }}><FolderOpen size={16} />打开数据文件夹</button>
          <button disabled={!directory} className="inline-flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm hover:bg-stone-50 disabled:opacity-40" onClick={() => void copyPrompt()}><Copy size={16} />复制准备迁移提示词</button>
        </div>
        {notice ? <p role="status" className="text-sm text-stone-600">{notice}</p> : null}
      </section>
      <section className="space-y-4">
        <h3 className="text-sm font-medium">换机步骤</h3>
        <ol className="list-decimal space-y-4 pl-5 text-sm leading-6 text-stone-600">
          <li><strong className="font-medium text-stone-900">准备数据。</strong>打开数据文件夹，完整复制或压缩 .zora，也可让 Zora 协助打包。建议当前任务结束后进行，外部项目文件另行携带。</li>
          <li><strong className="font-medium text-stone-900">在新设备恢复。</strong>提供副本的本地路径，让 Zora 检查内容并说明覆盖范围。确认后保留目标原数据备份，退出目标应用再放入完整目录，启动时自动完成格式升级。</li>
          <li><strong className="font-medium text-stone-900">重新关联项目。</strong>启动后，在置灰项目的菜单中选择“编辑项目”，更换本地文件夹并保存。暂时没有文件夹也可以查看历史。</li>
          <li><strong className="font-medium text-stone-900">检查并继续。</strong>打开旧会话和附件，检查模型、技能与 MCP。完成模型连接测试，再让旧会话读取新目录中的文件。定时任务和飞书接入在本机确认后启用。</li>
        </ol>
      </section>
      <div className="space-y-2 border-t border-stone-100 pt-5 text-sm leading-6 text-stone-500">
        <p>两台设备都有新数据时，请分别保留原始数据，再决定恢复哪一份。当前不提供自动合并；只带配置的副本不能替换已有会话。</p>
        <p>数据目录可能包含密钥，请妥善保管副本。登录状态、外部工具以及部分置顶、排序和界面偏好需要重新设置。跨系统恢复需另行验证。</p>
      </div>
    </div>
  );
}
