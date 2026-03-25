import { createPortal } from "react-dom";
import {
  SquarePen,
  MessageSquarePlus,
  FolderPlus,
  Archive,
  Pencil,
  ExternalLink,
  EyeOff,
  Loader2,
  Terminal,
  TerminalSquare,
  Pin,
  type LucideIcon,
} from "lucide-react";
import { createFolderAndRename } from "./folder-actions";
import { Command } from "@tauri-apps/plugin-shell";
import { logger } from "@/lib/logger-client";
import { cn } from "@/lib/utils";
import type { TreeItemNode } from "@/stores/tree-menu/types";
import { useSettingsStore } from "@/entities/settings/store";
import { Tooltip } from "@/components/ui/tooltip";

// ═══════════════════════════════════════════════════════════════════════════
// New thread pill button (replaces the old dropdown PlusMenu)
// ═══════════════════════════════════════════════════════════════════════════

interface PlusMenuProps {
  item: TreeItemNode;
  isCreatingWorktree?: boolean;
  onNewThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewClaudeSession?: (repoId: string, worktreeId: string, worktreePath: string) => void;
}

export function PlusMenu({
  item, isCreatingWorktree,
  onNewThread, onNewClaudeSession,
}: PlusMenuProps) {
  if (!onNewThread && !onNewClaudeSession) return null;

  const preferTui = useSettingsStore((s) => s.workspace.preferTerminalInterface) ?? false;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCreatingWorktree) return;
    const repoId = item.repoId!;
    const worktreeId = item.worktreeId ?? item.id;
    const worktreePath = item.worktreePath!;
    const handler = preferTui ? onNewClaudeSession : onNewThread;
    handler?.(repoId, worktreeId, worktreePath);
  };

  const tooltipLabel = `New thread in ${item.worktreeName ?? "workspace"}`;

  return (
    <Tooltip content={tooltipLabel} side="right">
      <button
        type="button"
        onClick={handleClick}
        disabled={isCreatingWorktree}
        className="flex items-center justify-center w-5 h-5 rounded bg-transparent hover:bg-surface-700 text-surface-400 hover:text-surface-100 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={tooltipLabel}
      >
        {isCreatingWorktree ? <Loader2 size={10} className="animate-spin" /> : <SquarePen size={10} />}
      </button>
    </Tooltip>
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
  onNewClaudeSession?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewManagedThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewTerminal?: (worktreeId: string, worktreePath: string) => void;
  onArchiveWorktree?: (repoName: string, worktreeId: string, worktreeName: string) => void;
  onHideWorktree?: (worktreeId: string) => void;
  onClose: () => void;
  onStartRename: () => void;
}

export function WorktreeContextMenu({
  item, show, position, menuRef, isPinned,
  onPinToggle, onNewThread, onNewClaudeSession, onNewManagedThread, onNewTerminal,
  onArchiveWorktree, onHideWorktree,
  onClose, onStartRename,
}: WorktreeContextMenuProps) {
  const preferTui = useSettingsStore((s) => s.workspace.preferTerminalInterface) ?? false;

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
      {/* Primary "New thread" — creates the preferred type */}
      {preferTui
        ? onNewClaudeSession && <CtxItem icon={TerminalSquare} label="New thread" onClick={() => { close(); onNewClaudeSession(item.repoId!, wId, item.worktreePath!); }} />
        : onNewThread && <CtxItem icon={MessageSquarePlus} label="New thread" onClick={() => { close(); onNewThread(item.repoId!, wId, item.worktreePath!); }} />
      }
      {/* Override — show the non-default option */}
      {preferTui
        ? onNewManagedThread && <CtxItem icon={MessageSquarePlus} label="New managed thread" onClick={() => { close(); onNewManagedThread(item.repoId!, wId, item.worktreePath!); }} />
        : onNewClaudeSession && <CtxItem icon={TerminalSquare} label="New Claude session" onClick={() => { close(); onNewClaudeSession(item.repoId!, wId, item.worktreePath!); }} />
      }
      {onNewTerminal && <CtxItem icon={Terminal} label="New terminal" hint="⌘T" onClick={() => { close(); onNewTerminal(wId, item.worktreePath!); }} />}

      <div className="h-px bg-surface-700 my-1" />
      <CtxItem
        icon={FolderPlus}
        label="New folder"
        onClick={() => {
          close();
          void createFolderAndRename(item.id, item.id);
        }}
      />

      {isNonMain && <div className="h-px bg-surface-700 my-1" />}
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
