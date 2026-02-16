/**
 * TreeNode
 *
 * A single node in a tree view with:
 * - Indentation based on depth
 * - Expand/collapse toggle (if has children)
 * - Selection state
 * - Icon + label slots
 */

import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTreeIndentPx } from "@/lib/tree-indent";

export interface TreeNodeProps {
  /** Indentation depth (0 = root) */
  depth: number;
  /** Node label text */
  label: string;
  /** Optional icon to show before label */
  icon?: React.ReactNode;
  /** Whether this node is currently selected */
  isSelected?: boolean;
  /** Whether this node has children (shows expand toggle) */
  hasChildren?: boolean;
  /** Whether children are currently expanded */
  isExpanded?: boolean;
  /** Called when node is clicked */
  onClick?: () => void;
  /** Called when expand toggle is clicked */
  onToggleExpand?: () => void;
  /** Additional content to render after label (e.g., badges) */
  trailing?: React.ReactNode;
  /** Optional className for additional styling */
  className?: string;
  /** Data attribute for testing/querying */
  "data-node-id"?: string;
}

export function TreeNode({
  depth,
  label,
  icon,
  isSelected = false,
  hasChildren = false,
  isExpanded = false,
  onClick,
  onToggleExpand,
  trailing,
  className,
  "data-node-id": dataNodeId,
}: TreeNodeProps) {
  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand?.();
  };

  return (
    <div
      className={cn(
        "flex items-center h-7 px-2 cursor-pointer select-none",
        "text-sm text-surface-300 hover:bg-surface-800/50",
        isSelected && "bg-surface-800 text-surface-100",
        className
      )}
      style={{ paddingLeft: getTreeIndentPx(depth) }}
      onClick={onClick}
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? isExpanded : undefined}
      data-node-id={dataNodeId}
    >
      {/* Expand/collapse toggle */}
      {hasChildren ? (
        <button
          type="button"
          className="w-4 h-4 flex items-center justify-center mr-1 text-surface-500 hover:text-surface-300"
          onClick={handleExpandClick}
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ) : (
        <span className="w-4 h-4 mr-1" /> // Spacer for alignment
      )}

      {/* Icon */}
      {icon && (
        <span className="w-4 h-4 mr-2 flex items-center justify-center text-surface-400">
          {icon}
        </span>
      )}

      {/* Label */}
      <span className="flex-1 truncate">{label}</span>

      {/* Trailing content */}
      {trailing && <span className="ml-2 flex-shrink-0">{trailing}</span>}
    </div>
  );
}
