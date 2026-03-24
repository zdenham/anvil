import { ChevronLeft, ChevronRight } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

interface SidebarCollapseButtonProps {
  isCollapsed: boolean;
  onClick: () => void;
}

/**
 * Apple-style collapse/expand button for the workspace sidebar.
 * Positioned at the left edge of the workspace, always visible.
 */
export function SidebarCollapseButton({ isCollapsed, onClick }: SidebarCollapseButtonProps) {
  return (
    <Tooltip content={isCollapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
      <button
        onClick={onClick}
        className="absolute top-3 left-2 z-10 w-6 h-6 flex items-center justify-center
                   rounded bg-surface-800/80 hover:bg-surface-700/80 border border-surface-600/50
                   text-surface-400 hover:text-surface-200 transition-colors"
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </Tooltip>
  );
}
