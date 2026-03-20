import { createPortal } from "react-dom";
import {
  Plus,
  MessageSquarePlus,
  FolderPlus,
  GitBranch,
  GitPullRequest,
  Archive,
  Pencil,
  ExternalLink,
  EyeOff,
  Loader2,
  Terminal,
  Pin,
  type LucideIcon,
} from "lucide-react";
import { createFolderAndRename } from "./folder-actions";
import { Command } from "@tauri-apps/plugin-shell";
import { logger } from "@/lib/logger-client";
import { cn } from "@/lib/utils";
import type { TreeItemNode } from "@/stores/tree-menu/types";

// ═══════════════════════════════════════════════════════════════════════════
// Plus menu (dropdown from + button on worktree header)
// ═══════════════════════════════════════════════════════════════════════════

interface PlusMenuProps {
  item: TreeItemNode;
  showMenu: boolean;
  setShowMenu: (show: boolean) => void;
  menuPosition: { top: number; left: number };
  buttonRef: React.RefObject<HTMLButtonElement>;
  menuRef: React.RefObject<HTMLDivElement>;
  isCreatingWorktree?: boolean;
  onNewThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewTerminal?: (worktreeId: string, worktreePath: string) => void;
  onCreatePr?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewWorktree?: (repoName: string) => void;
}

export function PlusMenu({
  item, showMenu, setShowMenu, menuPosition,
  buttonRef, menuRef, isCreatingWorktree,
  onNewThread, onNewTerminal, onCreatePr, onNewWorktree,
}: PlusMenuProps) {
  if (!onNewThread && !onNewWorktree) return null;

  const handlePlusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCreatingWorktree) return;
    setShowMenu(!showMenu);
  };

  const handlePlusDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    onNewThread?.(item.repoId!, item.worktreeId ?? item.id, item.worktreePath!);
  };

  const close = () => setShowMenu(false);

  return (
    <div className="flex items-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={handlePlusClick}
        onDoubleClick={handlePlusDoubleClick}
        disabled={isCreatingWorktree}
        className="flex items-center justify-center w-5 h-5 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Add new thread, workspace, or project (double-click for new thread)"
      >
        {isCreatingWorktree ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
      </button>

      {showMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 bg-surface-900 border border-surface-700 rounded-lg shadow-lg p-1.5"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          <PlusMenuItem icon={MessageSquarePlus} label={`New thread in ${item.worktreeName}`} hint="dbl-click" show={!!onNewThread} onClick={() => { close(); onNewThread?.(item.repoId!, item.worktreeId ?? item.id, item.worktreePath!); }} />
          <PlusMenuItem icon={Terminal} label={`New terminal in ${item.worktreeName}`} hint="⌘T" show={!!onNewTerminal} onClick={() => { close(); onNewTerminal?.(item.worktreeId ?? item.id, item.worktreePath!); }} />
          <PlusMenuItem icon={GitPullRequest} label="Create pull request" show={!!onCreatePr} onClick={() => { close(); onCreatePr?.(item.repoId!, item.worktreeId ?? item.id, item.worktreePath!); }} />
          <PlusMenuItem icon={GitBranch} label={`New workspace in ${item.repoName}`} show={!!onNewWorktree} onClick={() => { close(); onNewWorktree?.(item.repoName!); }} />
        </div>,
        document.body,
      )}
    </div>
  );
}

function PlusMenuItem({
  icon: Icon, label, hint, show, onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  show: boolean;
  onClick: () => void;
}) {
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
    >
      <Icon size={11} className="flex-shrink-0" />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-surface-500 ml-2">{hint}</span>}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Context menu (right-click on worktree header)
// ═══════════════════════════════════════════════════════════════════════════

interface WorktreeContextMenuProps {
  item: TreeItemNode;
  show: boolean;
  position: { top: number; left: number };
  menuRef: React.RefObject<HTMLDivElement>;
  isPinned?: boolean;
  onPinToggle?: (worktreeId: string) => void;
  onNewThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewTerminal?: (worktreeId: string, worktreePath: string) => void;
  onCreatePr?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewWorktree?: (repoName: string) => void;
  onArchiveWorktree?: (repoName: string, worktreeId: string, worktreeName: string) => void;
  onHideWorktree?: (worktreeId: string) => void;
  onClose: () => void;
  onStartRename: () => void;
}

export function WorktreeContextMenu({
  item, show, position, menuRef, isPinned,
  onPinToggle, onNewThread, onNewTerminal, onCreatePr,
  onNewWorktree, onArchiveWorktree, onHideWorktree,
  onClose, onStartRename,
}: WorktreeContextMenuProps) {
  if (!show) return null;

  const close = onClose;
  const wId = item.worktreeId ?? item.id;

  const openInCursor = async () => {
    try {
      const cmd = Command.create("open", ["-a", "Cursor", item.worktreePath!], {});
      await cmd.execute();
    } catch (err) {
      logger.error("[WorktreeItem] Failed to open worktree in Cursor:", err);
    }
  };

  const isNonMain = item.worktreeName !== "main";

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 bg-surface-900 border border-surface-700 rounded-lg shadow-lg p-1.5 min-w-[180px]"
      style={{ top: position.top, left: position.left }}
    >
      <CtxItem icon={ExternalLink} label="Open" onClick={() => { close(); openInCursor(); }} />

      {onPinToggle && <div className="h-px bg-surface-700 my-1" />}
      {onPinToggle && (
        <CtxItem
          icon={Pin}
          iconClass={isPinned ? "text-accent-400" : undefined}
          label={isPinned ? "Unpin workspace" : "Pin workspace"}
          onClick={() => { close(); onPinToggle(item.id); }}
        />
      )}
      {onHideWorktree && (
        <CtxItem
          icon={EyeOff}
          label="Hide workspace"
          onClick={() => { close(); onHideWorktree(item.id); }}
        />
      )}

      <div className="h-px bg-surface-700 my-1" />
      {onNewThread && <CtxItem icon={MessageSquarePlus} label="New thread" onClick={() => { close(); onNewThread(item.repoId!, wId, item.worktreePath!); }} />}
      {onNewTerminal && <CtxItem icon={Terminal} label="New terminal" hint="⌘T" onClick={() => { close(); onNewTerminal(wId, item.worktreePath!); }} />}
      {onCreatePr && <CtxItem icon={GitPullRequest} label="Create pull request" onClick={() => { close(); onCreatePr(item.repoId!, wId, item.worktreePath!); }} />}
      {onNewWorktree && <CtxItem icon={GitBranch} label="New workspace" onClick={() => { close(); onNewWorktree(item.repoName!); }} />}

      <div className="h-px bg-surface-700 my-1" />
      <CtxItem
        icon={FolderPlus}
        label="New folder"
        onClick={() => {
          close();
          void createFolderAndRename(item.id, item.id);
        }}
      />

      {isNonMain && (onNewThread || onNewWorktree) && <div className="h-px bg-surface-700 my-1" />}
      {isNonMain && <CtxItem icon={Pencil} label="Rename workspace" onClick={() => { onStartRename(); }} />}
      {onArchiveWorktree && isNonMain && (
        <CtxItem icon={Archive} label="Archive workspace" onClick={() => { close(); onArchiveWorktree(item.repoName!, wId, item.worktreeName!); }} />
      )}
    </div>,
    document.body,
  );
}

function CtxItem({
  icon: Icon, iconClass, label, hint, onClick,
}: {
  icon: LucideIcon;
  iconClass?: string;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
    >
      <Icon size={11} className={cn("flex-shrink-0", iconClass)} />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-surface-500 ml-2">{hint}</span>}
    </button>
  );
}
