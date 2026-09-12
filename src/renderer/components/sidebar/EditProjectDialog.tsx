import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, X } from "lucide-react";
import { useSetAtom } from "jotai";
import type { WorkspaceMeta } from "../../../shared/zora";
import { updateWorkspaceAtom } from "../../store/project-directory";
import { getErrorMessage } from "../../utils/message";

export function EditProjectDialog({ workspace, onClose }: {
  workspace: WorkspaceMeta;
  onClose: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [directory, setDirectory] = useState(workspace.path);
  const [saving, setSaving] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const updateWorkspace = useSetAtom(updateWorkspaceAtom);
  const busy = saving || choosing;
  const changed = name.trim() !== workspace.name || directory !== workspace.path;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { previous?.focus(); };
  }, []);

  const chooseDirectory = async () => {
    setChoosing(true);
    setError("");
    try {
      const selected = await window.zora.pickWorkspaceDirectory();
      if (selected) setDirectory(selected);
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setChoosing(false); }
  };

  const save = async () => {
    if (busy || !name.trim() || !changed) return;
    setSaving(true);
    setError("");
    try {
      await updateWorkspace({ workspaceId: workspace.id, name: name.trim(), directory });
      onClose();
    } catch (error) {
      setError(getErrorMessage(error));
      setSaving(false);
    }
  };

  return createPortal(
    <div className="titlebar-no-drag fixed inset-0 z-[180] flex items-center justify-center bg-stone-900/25 px-6 backdrop-blur-[2px]" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-project-title"
        aria-busy={busy}
        className="w-full max-w-[520px] rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_24px_70px_rgba(35,31,27,0.20)]"
        onSubmit={(event) => { event.preventDefault(); void save(); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); if (!busy) onClose(); }
          if (event.key === "Tab") {
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')];
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 id="edit-project-title" className="text-lg font-semibold text-stone-900">编辑项目</h2>
          <button type="button" aria-label="关闭编辑项目" disabled={busy} onClick={onClose} className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40"><X size={18} /></button>
        </div>
        <label className="block text-sm font-medium text-stone-700" htmlFor="edit-project-name">项目名称</label>
        <input id="edit-project-name" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-stone-200 px-3 text-sm text-stone-900 outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-900/10 disabled:opacity-60" />
        <label className="mt-5 block text-sm font-medium text-stone-700" htmlFor="edit-project-directory">本地文件夹</label>
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-stone-200 p-3">
          <Folder size={18} className="shrink-0 text-stone-400" />
          <textarea id="edit-project-directory" readOnly rows={3} value={directory} className="min-w-0 flex-1 resize-none break-all bg-transparent text-sm leading-5 text-stone-600 outline-none" />
          <button type="button" disabled={busy} onClick={() => void chooseDirectory()} className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-40">选择文件夹</button>
        </div>
        {error ? <p role="alert" className="mt-4 text-sm text-red-600">{error}</p> : null}
        <div className="mt-7 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-40">取消</button>
          <button type="submit" disabled={busy || !name.trim() || !changed} className="rounded-lg bg-stone-900 px-5 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-default disabled:opacity-40">{saving ? "保存中…" : "保存"}</button>
        </div>
      </form>
    </div>, document.body,
  );
}
