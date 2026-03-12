/**
 * TabItem — individual tab rendered inside the TabBar.
 *
 * Supports click-to-activate, close button (x), middle-click-to-close,
 * status dot, and drag-and-drop via dnd-kit useSortable.
 */

import { useCallback, useMemo } from "react";
import { useDndContext } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, Pause } from "lucide-react";
import { useThreadStore } from "@/entities/threads/store";
import { terminalSessionService } from "@/entities/terminal-sessions";
import { useFileDirtyStore } from "@/stores/file-dirty-store";
import { paneLayoutService, usePaneLayoutStore } from "@/stores/pane-layout";
import { logger } from "@/lib/logger-client";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui";
import { useTabLabel } from "./use-tab-label";
import { useTabTooltip } from "./use-tab-tooltip";
import { useDndBridge } from "./dnd-context-bridge";
import type { TabItem as TabItemType } from "@/stores/pane-layout/types";
import type { ContentPaneView } from "@/components/content-pane/types";
import type { TabDragData } from "./use-tab-dnd";

type TabStatus = "streaming" | "running" | "paused" | "idle";

/** Derive tab status from the thread store. */
function useTabStatus(view: ContentPaneView): TabStatus {
  const status = useThreadStore(
    useCallback(
      (s) => {
        if (view.type !== "thread") return null;
        return s.threads[view.threadId]?.status ?? null;
      },
      [view],
    ),
  );
  if (status === "running") return "streaming";
  if (status === "paused") return "paused";
  return "idle";
}

interface TabItemProps {
  tab: TabItemType;
  groupId: string;
  isActive: boolean;
}

/** Check if a file tab has unsaved changes. */
function useFileDirty(view: ContentPaneView): boolean {
  return useFileDirtyStore(
    useCallback(
      (s) => (view.type === "file" ? s.dirtyFiles.has(view.filePath) : false),
      [view],
    ),
  );
}

export function TabItem({ tab, groupId, isActive }: TabItemProps) {
  const label = useTabLabel(tab.view);
  const tooltip = useTabTooltip(tab.view);
  const status = useTabStatus(tab.view);
  const isFileDirty = useFileDirty(tab.view);
  const { active, over } = useDndContext();
  const { activeEdgeZone } = useDndBridge();

  const dragData: TabDragData = useMemo(
    () => ({ type: "tab", tabId: tab.id, groupId, view: tab.view }),
    [tab.id, groupId, tab.view],
  );

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id, data: dragData });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Determine drop indicator side when this tab is the hover target
  const dropIndicatorSide = useMemo((): "left" | "right" | null => {
    if (!active || over?.id !== tab.id || active.id === tab.id || activeEdgeZone)
      return null;
    const activeData = active.data.current as TabDragData | undefined;
    if (activeData?.type !== "tab") return null;
    if (activeData.groupId === groupId) {
      const group = usePaneLayoutStore.getState().groups[groupId];
      if (!group) return null;
      const activeIdx = group.tabs.findIndex((t) => t.id === activeData.tabId);
      const overIdx = group.tabs.findIndex((t) => t.id === tab.id);
      return activeIdx < overIdx ? "right" : "left";
    }
    return "left";
  }, [active, over, tab.id, groupId, activeEdgeZone]);

  const handleClick = useCallback(async () => {
    // Revive dead terminal when clicking its tab
    if (tab.view.type === "terminal") {
      const session = terminalSessionService.get(tab.view.terminalId);
      if (session && !session.isAlive && !session.isArchived) {
        try {
          await terminalSessionService.revive(tab.view.terminalId);
        } catch (err) {
          logger.warn("[TabItem] Failed to revive terminal (non-fatal):", err);
        }
      }
    }
    paneLayoutService.setActiveTab(groupId, tab.id);
  }, [groupId, tab.id, tab.view]);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      paneLayoutService.closeTab(groupId, tab.id);
    },
    [groupId, tab.id],
  );

  const handleAuxClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        paneLayoutService.closeTab(groupId, tab.id);
      }
    },
    [groupId, tab.id],
  );

  return (
    <Tooltip content={tooltip} side="top" delayDuration={200}>
      <button
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        data-testid={`tab-item-${tab.id}`}
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        className={cn(
          "group relative flex items-center gap-1.5 px-2.5 py-1.5 max-w-[200px] flex-shrink-0 text-xs font-medium transition-colors duration-150 rounded-md",
          isActive
            ? "bg-surface-800 text-surface-200"
            : "text-surface-500 hover:bg-surface-800/50 hover:text-surface-300",
          isDragging && "opacity-50",
        )}
      >
        {dropIndicatorSide && (
          <div
            className={cn(
              "absolute top-1 bottom-1 w-0.5 rounded-full bg-accent-500 z-10",
              dropIndicatorSide === "left" ? "-left-px" : "-right-px",
            )}
          />
        )}
        <StatusDot status={status} />
        <span className="flex-1 truncate text-left">{label}</span>
        <span
          role="button"
          data-testid={`tab-close-${tab.id}`}
          onClick={handleClose}
          className={cn(
            "flex-shrink-0 p-0.5 rounded cursor-pointer",
            "opacity-100",
          )}
          aria-label={`Close ${label}`}
        >
          {isFileDirty ? (
            <span className="flex items-center justify-center w-[10px] h-[10px]">
              <span className="w-2 h-2 rounded-full bg-surface-300" />
            </span>
          ) : (
            <X size={10} />
          )}
        </span>
      </button>
    </Tooltip>
  );
}

/** Small status indicator for thread tabs. Hidden when idle. */
function StatusDot({ status }: { status: TabStatus }) {
  if (status === "idle") return null;

  if (status === "paused") {
    return <Pause size={10} className="flex-shrink-0 text-amber-400" />;
  }

  return (
    <span
      className={cn(
        "w-1.5 h-1.5 rounded-full flex-shrink-0",
        status === "streaming" && "bg-green-400 animate-pulse",
        status === "running" && "bg-green-400",
      )}
    />
  );
}
