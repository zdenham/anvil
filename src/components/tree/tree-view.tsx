/**
 * TreeView
 *
 * Container for tree nodes with:
 * - Keyboard navigation (arrow keys)
 * - ARIA tree role
 * - Focus management
 */

import { useRef, useCallback, type ReactNode } from "react";

export interface TreeViewProps {
  /** Tree content (TreeNode components) */
  children: ReactNode;
  /** Currently selected node ID */
  selectedId?: string | null;
  /** IDs of all visible nodes (for keyboard nav) */
  visibleNodeIds: string[];
  /** Called when selection changes via keyboard */
  onSelectionChange?: (nodeId: string) => void;
  /** Called when Enter is pressed on selected node */
  onActivate?: (nodeId: string) => void;
  /** Called when left arrow is pressed (collapse or go to parent) */
  onCollapse?: (nodeId: string) => void;
  /** Called when right arrow is pressed (expand) */
  onExpand?: (nodeId: string) => void;
  /** ARIA label for the tree */
  ariaLabel?: string;
  /** Optional className for additional styling */
  className?: string;
}

export function TreeView({
  children,
  selectedId,
  visibleNodeIds,
  onSelectionChange,
  onActivate,
  onCollapse,
  onExpand,
  ariaLabel = "Tree view",
  className,
}: TreeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectedId || visibleNodeIds.length === 0) return;

      const currentIndex = visibleNodeIds.indexOf(selectedId);
      if (currentIndex === -1) return;

      switch (e.key) {
        case "ArrowUp": {
          e.preventDefault();
          if (currentIndex > 0) {
            onSelectionChange?.(visibleNodeIds[currentIndex - 1]);
          }
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          if (currentIndex < visibleNodeIds.length - 1) {
            onSelectionChange?.(visibleNodeIds[currentIndex + 1]);
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          onCollapse?.(selectedId);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          onExpand?.(selectedId);
          break;
        }
        case "Enter": {
          e.preventDefault();
          onActivate?.(selectedId);
          break;
        }
        case "Home": {
          e.preventDefault();
          if (visibleNodeIds.length > 0) {
            onSelectionChange?.(visibleNodeIds[0]);
          }
          break;
        }
        case "End": {
          e.preventDefault();
          if (visibleNodeIds.length > 0) {
            onSelectionChange?.(visibleNodeIds[visibleNodeIds.length - 1]);
          }
          break;
        }
      }
    },
    [
      selectedId,
      visibleNodeIds,
      onSelectionChange,
      onActivate,
      onCollapse,
      onExpand,
    ]
  );

  return (
    <div
      ref={containerRef}
      className={`outline-none ${className ?? ""}`}
      role="tree"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}
