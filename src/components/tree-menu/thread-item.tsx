import { useState, useRef, useEffect, useCallback } from "react";
import { Archive, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/status-dot";
import type { TreeItemNode } from "@/stores/tree-menu/types";
import { ItemPreviewTooltip } from "./item-preview-tooltip";
import { threadService } from "@/entities/threads/service";

interface ThreadItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onSelect: (itemId: string, itemType: "thread" | "plan") => void;
  tabIndex?: number;
}

/**
 * Thread row in the tree menu.
 * Displays status dot and thread title.
 * Styled like VSCode file entries.
 * Supports hover archive button with confirmation.
 */
export function ThreadItem({
  item,
  isSelected,
  onSelect,
  tabIndex = -1,
}: ThreadItemProps) {
  const [confirming, setConfirming] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

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
      await threadService.archive(item.id);
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
    onSelect(item.id, "thread");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(item.id, "thread");
    }
  };

  return (
    <ItemPreviewTooltip itemId={item.id} itemType="thread">
      <div
        role="treeitem"
        aria-selected={isSelected}
        tabIndex={tabIndex}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "group flex items-center gap-1.5 py-0.5 px-2 pl-8 cursor-pointer",
          "text-[13px] leading-[22px]",
          "transition-colors duration-75",
          "outline-none",
          isSelected
            ? "bg-accent-500/20 text-surface-100"
            : "text-surface-300 hover:bg-surface-800/50"
        )}
      >
        <StatusDot variant={item.status} className="flex-shrink-0" />
        <span className="truncate flex-1" title={item.title}>{item.title}</span>
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
          aria-label={confirming ? "Confirm archive" : "Archive"}
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
    </ItemPreviewTooltip>
  );
}
