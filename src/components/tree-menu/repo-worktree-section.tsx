import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, ChevronDown, Plus, MessageSquarePlus, FolderGit2, GitBranch, Archive, Pencil, ExternalLink, Loader2 } from "lucide-react";
import { Command } from "@tauri-apps/plugin-shell";
import { logger } from "@/lib/logger-client";
import { worktreeService } from "@/entities/worktrees/service";
import { cn } from "@/lib/utils";
import type { RepoWorktreeSection as RepoWorktreeSectionType } from "@/stores/tree-menu/types";
import { ThreadItem } from "./thread-item";
import { PlanItem } from "./plan-item";
import { INDENT_STEP } from "./use-tree-keyboard-nav";

interface RepoWorktreeSectionProps {
  section: RepoWorktreeSectionType;
  selectedItemId: string | null;
  onToggle: (sectionId: string) => void;
  onItemSelect: (itemId: string, itemType: "thread" | "plan") => void;
  showDivider: boolean;
  /** Called when user wants to create a new thread in this worktree */
  onNewThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  /** Called when user wants to create a new worktree in this repo */
  onNewWorktree?: (repoId: string) => void;
  /** Called when user wants to add a new repository */
  onNewRepo?: () => void;
  /** Called when user wants to archive a worktree */
  onArchiveWorktree?: (repoId: string, worktreeId: string, worktreeName: string) => void;
  /** Called when tree menu needs to refresh (e.g., after rename) */
  onRefresh?: () => void;
  /** Whether a worktree is being created for this repo (shows spinner) */
  isCreatingWorktree?: boolean;
}

/**
 * Section header with +/- toggle for a repo/worktree.
 * Displays as "repoName / worktreeName" with horizontal divider above (except first).
 * Contains child items (threads and plans) when expanded.
 */
export function RepoWorktreeSection({
  section,
  selectedItemId,
  onToggle,
  onItemSelect,
  showDivider,
  onNewThread,
  onNewWorktree,
  onNewRepo,
  onArchiveWorktree,
  onRefresh,
  isCreatingWorktree,
}: RepoWorktreeSectionProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Context menu state (separate from plus menu)
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ top: 0, left: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(section.worktreeName);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Update menu position when showing
  useEffect(() => {
    if (showMenu && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.top,
        left: rect.right + 4, // 4px gap to the right of the button
      });
    }
  }, [showMenu]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setShowMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  // Close context menu when clicking outside
  useEffect(() => {
    if (!showContextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (contextMenuRef.current && !contextMenuRef.current.contains(target)) {
        setShowContextMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showContextMenu]);

  // Focus rename input when renaming starts
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleToggle = () => {
    onToggle(section.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle(section.id);
    }
  };

  const handlePlusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(!showMenu);
  };

  const handlePlusDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    onNewThread?.(section.repoId, section.worktreeId, section.worktreePath);
  };

  const handleNewThread = () => {
    setShowMenu(false);
    onNewThread?.(section.repoId, section.worktreeId, section.worktreePath);
  };

  const handleNewWorktree = () => {
    setShowMenu(false);
    onNewWorktree?.(section.repoName);
  };

  const handleNewRepo = () => {
    setShowMenu(false);
    onNewRepo?.();
  };

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(false); // Close plus menu if open
    setContextMenuPosition({ top: e.clientY, left: e.clientX });
    setShowContextMenu(true);
  };

  const handleContextNewThread = () => {
    setShowContextMenu(false);
    onNewThread?.(section.repoId, section.worktreeId, section.worktreePath);
  };

  const handleContextNewWorktree = () => {
    setShowContextMenu(false);
    onNewWorktree?.(section.repoName);
  };

  const handleContextNewRepo = () => {
    setShowContextMenu(false);
    onNewRepo?.();
  };

  const handleContextArchiveWorktree = () => {
    setShowContextMenu(false);
    onArchiveWorktree?.(section.repoName, section.worktreeId, section.worktreeName);
  };

  const openInCursor = async () => {
    try {
      logger.log(`[WorktreeRow] Opening worktree in Cursor`, {
        name: section.worktreeName,
        path: section.worktreePath,
      });

      const cmd = Command.create("open", ["-a", "Cursor", section.worktreePath], {});
      await cmd.execute();
      logger.log(`[WorktreeRow] Opened worktree "${section.worktreeName}" in Cursor`);
    } catch (err) {
      logger.error(`[WorktreeRow] Failed to open worktree in Cursor`, {
        name: section.worktreeName,
        path: section.worktreePath,
        error: err,
      });
    }
  };

  const handleContextOpenInCursor = () => {
    setShowContextMenu(false);
    openInCursor();
  };

  // Rename handlers
  const handleStartRename = useCallback(() => {
    setRenameValue(section.worktreeName);
    setIsRenaming(true);
    setShowContextMenu(false);
  }, [section.worktreeName]);

  const handleRenameSubmit = useCallback(async () => {
    const trimmedName = renameValue.trim();

    // Validate: non-empty, valid characters
    if (!trimmedName || !/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
      // Reset to original on invalid input
      setRenameValue(section.worktreeName);
      setIsRenaming(false);
      return;
    }

    // Skip if unchanged
    if (trimmedName === section.worktreeName) {
      setIsRenaming(false);
      return;
    }

    try {
      await worktreeService.rename(section.repoName, section.worktreeName, trimmedName);
      // Refresh tree menu to reflect the change
      onRefresh?.();
    } catch (error) {
      console.error('Failed to rename worktree:', error);
      // Reset on error
      setRenameValue(section.worktreeName);
    }

    setIsRenaming(false);
  }, [renameValue, section.repoName, section.worktreeName, onRefresh]);

  const handleRenameCancel = useCallback(() => {
    setRenameValue(section.worktreeName);
    setIsRenaming(false);
  }, [section.worktreeName]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleRenameCancel();
    }
  }, [handleRenameSubmit, handleRenameCancel]);

  return (
    <div role="group" aria-label={`${section.repoName} / ${section.worktreeName}`}>
      {/* Divider above section (except first) */}
      {showDivider && (
        <div
          className="border-t border-dashed border-surface-700/50 mx-2 my-1"
          role="separator"
          aria-orientation="horizontal"
        />
      )}

      {/* Section header */}
      <div
        role="treeitem"
        aria-expanded={section.isExpanded}
        tabIndex={-1}
        className={cn(
          "group flex items-center gap-1.5 pr-1 py-2.5 cursor-pointer select-none",
          !showDivider && "pt-3.5", // Extra top padding for first section
          "text-[13px] font-semibold text-surface-200",
          "transition-colors duration-75"
        )}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      >
        {/* Toggle icon - same width as item chevrons/dots */}
        <button
          type="button"
          className="flex-shrink-0 w-3 h-3 flex items-center justify-center rounded hover:bg-surface-700 text-surface-400"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(section.id);
          }}
          aria-label={section.isExpanded ? "Collapse section" : "Expand section"}
        >
          {section.isExpanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
        </button>

        {/* Section title */}
        <span className="truncate font-mono">
          {section.repoName} /{' '}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleRenameKeyDown}
              className="bg-transparent border-b border-zinc-500 outline-none px-0 py-0 text-inherit font-inherit w-24"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            section.worktreeName
          )}
        </span>

        {/* Item count badge */}
        <span className="ml-auto text-xs text-surface-500 font-normal">
          {section.items.length}
        </span>

        {/* Plus button - always visible */}
        {(onNewThread || onNewWorktree || onNewRepo) && (
          <div className="flex items-center">
            <button
              ref={buttonRef}
              type="button"
              onClick={handlePlusClick}
              onDoubleClick={handlePlusDoubleClick}
              disabled={isCreatingWorktree}
              className="flex items-center justify-center w-5 h-5 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Add new thread, worktree, or repository (double-click for new thread)"
            >
              {isCreatingWorktree ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
            </button>

            {/* Popup menu - rendered in portal to escape overflow */}
            {showMenu && createPortal(
              <div
                ref={menuRef}
                className="fixed z-50 bg-surface-900 border border-surface-700 rounded-lg shadow-lg p-1.5"
                style={{ top: menuPosition.top, left: menuPosition.left }}
              >
                  {onNewThread && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNewThread();
                      }}
                      className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
                    >
                      <MessageSquarePlus size={11} className="flex-shrink-0" />
                      <span className="flex-1">New thread in {section.worktreeName}</span>
                      <span className="text-surface-500 ml-2">dbl-click</span>
                    </button>
                  )}
                  {onNewWorktree && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNewWorktree();
                      }}
                      className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
                    >
                      <GitBranch size={11} className="flex-shrink-0" />
                      New worktree in {section.repoName}
                    </button>
                  )}
                  {onNewRepo && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNewRepo();
                      }}
                      className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
                    >
                      <FolderGit2 size={11} className="flex-shrink-0" />
                      New repository
                    </button>
                  )}
              </div>,
              document.body
            )}
          </div>
        )}
      </div>

      {/* Context menu - rendered in portal */}
      {showContextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-surface-900 border border-surface-700 rounded-lg shadow-lg p-1.5 min-w-[180px]"
          style={{ top: contextMenuPosition.top, left: contextMenuPosition.left }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleContextOpenInCursor();
            }}
            className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
          >
            <ExternalLink size={11} className="flex-shrink-0" />
            Open
          </button>
          <div className="h-px bg-surface-700 my-1" />
          {onNewThread && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleContextNewThread();
              }}
              className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
            >
              <MessageSquarePlus size={11} className="flex-shrink-0" />
              New thread
            </button>
          )}
          {onNewWorktree && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleContextNewWorktree();
              }}
              className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
            >
              <GitBranch size={11} className="flex-shrink-0" />
              New worktree
            </button>
          )}
          {onNewRepo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleContextNewRepo();
              }}
              className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
            >
              <FolderGit2 size={11} className="flex-shrink-0" />
              New repository
            </button>
          )}
          {/* Divider before rename/archive - only show for non-main worktrees */}
          {section.worktreeName !== 'main' && (onNewThread || onNewWorktree || onNewRepo) && (
            <div className="h-px bg-surface-700 my-1" />
          )}
          {/* Rename worktree - only for non-main worktrees */}
          {section.worktreeName !== 'main' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleStartRename();
              }}
              className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
            >
              <Pencil size={11} className="flex-shrink-0" />
              Rename worktree
            </button>
          )}
          {onArchiveWorktree && section.worktreeName !== 'main' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleContextArchiveWorktree();
              }}
              className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
            >
              <Archive size={11} className="flex-shrink-0" />
              Archive worktree
            </button>
          )}
        </div>,
        document.body
      )}

      {/* Child items when expanded - with animation */}
      <div
        role="group"
        aria-label="Items"
        className={`tree-children ${section.isExpanded ? 'expanded' : 'collapsed'}`}
      >
        {section.items.map((item, index) =>
          item.type === "thread" ? (
            <ThreadItem
              key={item.id}
              item={item}
              isSelected={selectedItemId === item.id}
              onSelect={onItemSelect}
              itemIndex={index}
              allItems={section.items}
            />
          ) : (
            <PlanItem
              key={item.id}
              item={item}
              isSelected={selectedItemId === item.id}
              onSelect={onItemSelect}
              itemIndex={index}
              allItems={section.items}
            />
          )
        )}
      </div>
    </div>
  );
}
