import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { cancelAgent } from "@/lib/agent-service";
import { StopCircle, ChevronRight, X, GitCompare, MessageSquare, PictureInPicture2 } from "lucide-react";
import type { ControlPanelViewType } from "@/entities/events";
import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";
import { logger } from "@/lib/logger-client";
import { showMainWindowWithView } from "@/lib/hotkey-service";

interface ControlPanelHeaderProps {
  view: ControlPanelViewType;
  // Thread-specific props (only used when view.type === "thread")
  threadTab?: "conversation" | "changes";
  onThreadTabChange?: (tab: "conversation" | "changes") => void;
  isStreaming?: boolean;
  // Standalone window props
  isStandaloneWindow?: boolean;
  instanceId?: string | null;
}

/**
 * Get the status variant based on streaming state and read state
 */
function getStatusVariant(isStreaming: boolean, isRead?: boolean): StatusDotVariant {
  if (isStreaming) {
    return "running";
  }
  if (isRead === false) {
    return "unread";
  }
  return "read";
}

export function ControlPanelHeader({
  view,
  threadTab = "conversation",
  onThreadTabChange,
  isStreaming = false,
  isStandaloneWindow = false,
  instanceId,
}: ControlPanelHeaderProps) {
  const handleClose = async () => {
    if (isStandaloneWindow && instanceId) {
      // Close standalone window
      await invoke("close_control_panel_window", { instanceId });
    } else {
      // Hide NSPanel
      await invoke("hide_control_panel");
    }
  };

  // Render based on view type
  if (view.type === "plan") {
    return (
      <PlanModeHeader
        planId={view.planId}
        onClose={handleClose}
        isStandaloneWindow={isStandaloneWindow}
      />
    );
  }

  // Thread mode header
  return (
    <ThreadModeHeader
      threadId={view.threadId}
      threadTab={threadTab}
      onThreadTabChange={onThreadTabChange}
      isStreaming={isStreaming}
      onClose={handleClose}
      isStandaloneWindow={isStandaloneWindow}
    />
  );
}

/**
 * Header for Plan view mode.
 * Shows plan name/title, no tabs, no streaming indicators.
 */
function PlanModeHeader({
  planId,
  onClose,
  isStandaloneWindow = false,
}: {
  planId: string;
  onClose: () => void;
  isStandaloneWindow?: boolean;
}) {
  const plan = usePlanStore(
    useCallback((s) => s.getPlan(planId), [planId])
  );
  // Use the file name from relativePath, or truncated ID as fallback
  const planLabel = plan?.relativePath?.split('/').pop() ?? planId.slice(0, 8) + "...";

  const handleOpenInMainWindow = async () => {
    try {
      logger.info(`[control-panel-header] Opening plan in main window: ${planId}`);
      // Open in main window content pane
      await showMainWindowWithView({ type: "plan", planId });
      // Hide the NSPanel
      await invoke("hide_control_panel");
      // Focus the main window
      await invoke("show_main_window");
      logger.info(`[control-panel-header] Plan opened in main window successfully`);
    } catch (err) {
      logger.error(`[control-panel-header] Failed to open plan in main window:`, err);
    }
  };

  return (
    <div
      className="group flex items-center gap-3 px-4 pt-[100px] pb-3 bg-surface-800 border-b border-surface-700"
      data-drag-region="header"
    >
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1.5 text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="text-surface-400 hover:text-surface-200 focus:outline-none focus:text-surface-200 transition-colors"
        >
          plans
        </button>
        <ChevronRight size={12} className="text-surface-500" />
        <span className="text-surface-300 truncate max-w-[200px]">{planLabel}</span>
      </div>
      <div className="ml-auto flex items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
        {/* Open in main window button - only show in NSPanel, not in standalone windows */}
        {!isStandaloneWindow && (
          <button
            onClick={handleOpenInMainWindow}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Open in main window"
            title="Open in main window"
          >
            <PictureInPicture2 size={16} />
          </button>
        )}
        {/* Close button - only show in NSPanel, standalone windows use native traffic lights */}
        {!isStandaloneWindow && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Close panel (Escape)"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Header for Thread view mode.
 * Shows status dot, breadcrumb, cancel button when streaming, tab toggle.
 */
function ThreadModeHeader({
  threadId,
  threadTab,
  onThreadTabChange,
  isStreaming,
  onClose,
  isStandaloneWindow = false,
}: {
  threadId: string;
  threadTab: "conversation" | "changes";
  onThreadTabChange?: (tab: "conversation" | "changes") => void;
  isStreaming: boolean;
  onClose: () => void;
  isStandaloneWindow?: boolean;
}) {
  const thread = useThreadStore(
    useCallback((s) => s.threads[threadId], [threadId])
  );

  const handleCancel = async () => {
    console.log(`[control-panel-header] Cancel button clicked for threadId=${threadId}`);
    const result = await cancelAgent(threadId);
    console.log(`[control-panel-header] cancelAgent returned: ${result}`);
  };

  const handleOpenInMainWindow = async () => {
    try {
      logger.info(`[control-panel-header] Opening thread in main window: ${threadId}`);
      // Open in main window content pane
      await showMainWindowWithView({ type: "thread", threadId });
      // Hide the NSPanel
      await invoke("hide_control_panel");
      // Focus the main window
      await invoke("show_main_window");
      logger.info(`[control-panel-header] Thread opened in main window successfully`);
    } catch (err) {
      logger.error(`[control-panel-header] Failed to open thread in main window:`, err);
    }
  };

  const handleToggle = () => {
    if (onThreadTabChange) {
      onThreadTabChange(threadTab === "conversation" ? "changes" : "conversation");
    }
  };

  // Display last user message (or truncated ID as fallback)
  const threadLabel = (() => {
    if (!thread?.turns || thread.turns.length === 0) {
      return threadId.slice(0, 8) + "...";
    }
    const lastTurn = thread.turns[thread.turns.length - 1];
    if (!lastTurn?.prompt) {
      return threadId.slice(0, 8) + "...";
    }
    // Truncate long messages for display in breadcrumb
    const maxLength = 50;
    if (lastTurn.prompt.length > maxLength) {
      return lastTurn.prompt.slice(0, maxLength) + "...";
    }
    return lastTurn.prompt;
  })();

  return (
    <div
      className="group flex items-center gap-3 px-4 py-3 bg-surface-800 border-b border-surface-700"
      data-drag-region="header"
    >
      {/* Status dot */}
      <StatusDot variant={getStatusVariant(isStreaming, thread?.isRead)} />
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1.5 text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="text-surface-400 hover:text-surface-200 focus:outline-none focus:text-surface-200 transition-colors"
        >
          threads
        </button>
        <ChevronRight size={12} className="text-surface-500" />
        <span className="text-surface-300 truncate max-w-[300px]">{threadLabel}</span>
      </div>
      <div className="ml-auto flex items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
        {isStreaming && (
          <button
            onClick={handleCancel}
            className="px-1.5 py-0.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors flex items-center gap-1 text-xs"
            aria-label="Cancel agent"
          >
            <StopCircle size={12} />
            Cancel
          </button>
        )}
        {/* Tab toggle: conversation <-> changes (two-way) */}
        {onThreadTabChange && (
          <button
            onClick={handleToggle}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label={threadTab === "conversation" ? "View changes" : "View conversation"}
            title={threadTab === "conversation" ? "View changes" : "View conversation"}
          >
            {threadTab === "conversation" ? (
              <GitCompare size={16} />
            ) : (
              <MessageSquare size={16} />
            )}
          </button>
        )}
        {/* Open in main window button - only show in NSPanel, not in standalone windows */}
        {!isStandaloneWindow && (
          <button
            onClick={handleOpenInMainWindow}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Open in main window"
            title="Open in main window"
          >
            <PictureInPicture2 size={16} />
          </button>
        )}
        {/* Close button - only show in NSPanel, standalone windows use native traffic lights */}
        {!isStandaloneWindow && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Close panel (Escape)"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
