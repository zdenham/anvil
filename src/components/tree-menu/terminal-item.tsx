import { useState, useRef, useEffect, useCallback } from "react";
import { Archive, Loader2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TreeItemNode } from "@/stores/tree-menu/types";
import { terminalSessionService } from "@/entities/terminal-sessions";
import { TREE_INDENT_BASE, TREE_INDENT_STEP } from "@/lib/tree-indent";

/**
 * Get text color class based on terminal state.
 * Alive terminals are dimmer (surface-400), exited are dimmer still.
 */
function getTextColorClass(isAlive: boolean, isSelected: boolean): string {
  if (isSelected) return "";
  return isAlive ? "text-surface-400" : "text-surface-500";
}

interface TerminalItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onSelect: (itemId: string, itemType: "terminal") => void;
  tabIndex?: number;
  /** Index in the flat list for keyboard navigation */
  itemIndex?: number;
}

/**
 * Terminal row in the tree menu.
 * Displays terminal icon and label (last command or directory name).
 * Supports hover archive button to kill the PTY.
 */
export function TerminalItem({
  item,
  isSelected,
  onSelect,
  tabIndex = -1,
  itemIndex = 0,
}: TerminalItemProps) {
  const [confirming, setConfirming] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Terminals with "unread" status are exited (see use-tree-data.ts)
  const isAlive = item.status !== "unread";

  // Click outside to cancel confirmation
  useEffect(() => {
    if (!confirming) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setConfirming(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [confirming]);

  const handleArchive = useCallback(async () => {
    setIsArchiving(true);
    try {
      await terminalSessionService.archive(item.id);
    } finally {
      setIsArchiving(false);
      setConfirming(false);
    }
  }, [item.id]);

  const handleArchiveClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isArchiving) return;

    if (confirming) {
      await handleArchive();
    } else {
      setConfirming(true);
    }
  };

  const handleClick = () => {
    onSelect(item.id, "terminal");
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        onSelect(item.id, "terminal");
        break;
    }
  }, [item.id, onSelect]);

  // Calculate indentation based on depth using shared constants
  const indentPx = TREE_INDENT_BASE + (item.depth * TREE_INDENT_STEP);

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      data-testid={`terminal-item-${item.id}`}
      data-tree-item-index={itemIndex}
      tabIndex={tabIndex}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ paddingLeft: `${indentPx}px` }}
      className={cn(
        "group flex items-center gap-1.5 py-0.5 pr-1 cursor-pointer",
        "text-[13px] leading-[22px]",
        "transition-colors duration-75",
        "outline-none focus:bg-accent-500/10",
        isSelected
          ? "bg-accent-500/20 text-surface-100"
          : "text-surface-300 hover:bg-accent-500/10"
      )}
    >
      {/* Terminal icon - same width as status dot */}
      <span className="flex-shrink-0 w-3 flex items-center justify-center">
        <Terminal size={10} className={cn(
          isAlive ? "text-surface-400" : "text-surface-500"
        )} />
      </span>
      <span
        className={cn("truncate flex-1", getTextColorClass(isAlive, isSelected))}
        title={item.title}
      >
        {item.title}
      </span>
      {/* Exited indicator */}
      {!isAlive && (
        <span className="text-[10px] text-surface-500 font-mono">(exited)</span>
      )}
      {/* Archive button - fixed height to prevent layout shift */}
      <button
        ref={buttonRef}
        className={cn(
          "h-[12px] flex items-center justify-center transition-colors flex-shrink-0",
          isArchiving
            ? "text-surface-500"
            : confirming
              ? "opacity-100 text-surface-300 text-[11px] font-medium"
              : "opacity-0 group-hover:opacity-100 text-surface-500 hover:text-surface-300"
        )}
        onClick={handleArchiveClick}
        aria-label={confirming ? "Confirm archive" : "Archive terminal"}
        disabled={isArchiving}
      >
        {isArchiving ? (
          <Loader2 size={12} className="animate-spin" />
        ) : confirming ? (
          "confirm"
        ) : (
          <Archive size={12} />
        )}
      </button>
    </div>
  );
}
