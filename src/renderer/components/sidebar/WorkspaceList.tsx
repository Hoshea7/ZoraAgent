import { useAtom } from "jotai";
import { workspacesAtom, currentWorkspaceIdAtom } from "../../store/workspace";
import { cn } from "../../utils/cn";

/**
 * 工作区列表组件
 * 显示工作区列表和新建按钮（当前为静态数据）
 */
export function WorkspaceList() {
  const [workspaces] = useAtom(workspacesAtom);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentWorkspaceIdAtom);

  return (
    <div className="space-y-1">
      {workspaces.map((workspace) => (
        <button
          key={workspace.id}
          onClick={() => setCurrentWorkspaceId(workspace.id)}
          className={cn(
            "flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13px] transition",
            currentWorkspaceId === workspace.id
              ? "bg-stone-900/[0.08] shadow-sm"
              : "hover:bg-stone-900/[0.04]"
          )}
        >
          <svg
            className="h-4 w-4 text-stone-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
          <span className="flex-1 truncate">{workspace.name}</span>
        </button>
      ))}

      <button className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13px] text-stone-500 transition hover:bg-stone-900/[0.04] hover:text-stone-700">
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
        <span>新建工作区</span>
      </button>
    </div>
  );
}
