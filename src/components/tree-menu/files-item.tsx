import { FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTreeIndentPx } from "@/lib/tree-indent";

interface FilesItemProps {
  repoId: string;
  worktreeId: string;
  worktreePath: string;
  isActive: boolean;
  onOpenFiles: (repoId: string, worktreeId: string, worktreePath: string) => void;
  /** Indentation depth (defaults to 0) */
  depth?: number;
}

/**
 * "Files" entry pinned at the top of a worktree section.
 * Opens the file browser panel. Highlights in accent color when active.
 *
 * Per decisions: click or Enter opens file browser; selection alone does not.
 * TODO: Integrate into focusableItems for full keyboard nav
 */
export function FilesItem({ repoId, worktreeId, worktreePath, isActive, onOpenFiles, depth }: FilesItemProps) {
  const handleClick = () => {
    onOpenFiles(repoId, worktreeId, worktreePath);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenFiles(repoId, worktreeId, worktreePath);
    }
  };

  return (
    <button
      type="button"
      role="treeitem"
      tabIndex={-1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ paddingLeft: `${getTreeIndentPx(depth ?? 0)}px` }}
      className={cn(
        "flex items-center gap-1.5 w-full pr-2 py-1 text-xs",
        "hover:bg-surface-800 rounded cursor-pointer select-none",
        isActive
          ? "text-accent-400"
          : "text-surface-400 hover:text-surface-200"
      )}
    >
      <span className="flex-shrink-0 w-3 flex items-center justify-center">
        <FolderOpen size={11} />
      </span>
      <span>Files</span>
    </button>
  );
}
