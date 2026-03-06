/**
 * WindowTitlebar — full-width bar at the top of the main window.
 *
 * Sits in the overlay titlebar area (to the right of macOS traffic lights).
 * Shows breadcrumbs for the active tab and panel toggle controls.
 */

import { useCallback } from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import { usePaneLayoutStore } from "@/stores/pane-layout";
import { useTabTooltip } from "@/components/split-layout/use-tab-tooltip";
import { cn } from "@/lib/utils";
import type { ContentPaneView } from "@/components/content-pane/types";

interface WindowTitlebarProps {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
}

const EMPTY_VIEW: ContentPaneView = { type: "empty" };

function useActiveTabView(): ContentPaneView {
  return usePaneLayoutStore(
    useCallback((s) => {
      const group = s.groups[s.activeGroupId];
      if (!group) return EMPTY_VIEW;
      const tab = group.tabs.find((t) => t.id === group.activeTabId);
      return tab?.view ?? EMPTY_VIEW;
    }, []),
  );
}

/** Convert "repo / worktree / threads / name" → "repo › worktree › threads › name" */
function formatBreadcrumb(tooltip: string): string {
  return tooltip.replace(/ \/ /g, " › ");
}

export function WindowTitlebar({
  leftPanelOpen,
  rightPanelOpen,
  onToggleLeftPanel,
  onToggleRightPanel,
}: WindowTitlebarProps) {
  const activeView = useActiveTabView();
  const tooltip = useTabTooltip(activeView);
  const breadcrumb = activeView.type !== "empty" ? formatBreadcrumb(tooltip) : "";

  return (
    <div
      data-tauri-drag-region
      className="pl-[76px] pr-2 h-[32px] flex items-center gap-2 border-b border-surface-600/40 bg-surface-900 flex-shrink-0"
    >
      {/* Breadcrumb — centered */}
      <div data-tauri-drag-region className="flex-1 flex justify-center min-w-0">
        <span
          data-tauri-drag-region
          className="text-[10px] text-surface-500/70 font-mono truncate select-none"
        >
          {breadcrumb}
        </span>
      </div>

      {/* Panel toggle controls */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={onToggleLeftPanel}
          className={cn(
            "flex items-center justify-center w-5 h-5 rounded transition-colors",
            leftPanelOpen
              ? "text-surface-600 hover:text-surface-400"
              : "text-surface-700 hover:text-surface-500",
          )}
        >
          <PanelLeft size={12} />
        </button>
        <button
          onClick={onToggleRightPanel}
          className={cn(
            "flex items-center justify-center w-5 h-5 rounded transition-colors",
            rightPanelOpen
              ? "text-surface-600 hover:text-surface-400"
              : "text-surface-700 hover:text-surface-500",
          )}
        >
          <PanelRight size={12} />
        </button>
      </div>
    </div>
  );
}
