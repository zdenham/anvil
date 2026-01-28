/**
 * ContentPaneHeader
 *
 * Header bar for content panes showing:
 * - Status dot + breadcrumb path
 * - Tab toggle (for threads)
 * - Pop-out button
 * - Close button
 *
 * Unlike ControlPanelHeader, this component:
 * - Uses callbacks instead of invoke() commands
 * - Has no window drag behavior
 * - Works identically in any container
 */

import { useCallback } from "react";
import {
  StopCircle,
  ChevronRight,
  X,
  GitCompare,
  MessageSquare,
  PictureInPicture2,
} from "lucide-react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";
import { useIsMainWindow } from "@/components/main-window/main-window-context";
import type { ContentPaneHeaderProps } from "./types";

function getStatusVariant(
  isStreaming: boolean,
  isRead?: boolean
): StatusDotVariant {
  if (isStreaming) return "running";
  if (isRead === false) return "unread";
  return "read";
}

export function ContentPaneHeader({
  view,
  threadTab = "conversation",
  onThreadTabChange,
  isStreaming = false,
  onClose,
  onPopOut,
}: ContentPaneHeaderProps) {
  if (view.type === "empty") {
    return null; // No header for empty state
  }

  if (view.type === "plan") {
    return (
      <PlanHeader planId={view.planId} onClose={onClose} onPopOut={onPopOut} />
    );
  }

  if (view.type === "thread") {
    return (
      <ThreadHeader
        threadId={view.threadId}
        threadTab={threadTab}
        onThreadTabChange={onThreadTabChange}
        isStreaming={isStreaming}
        onClose={onClose}
        onPopOut={onPopOut}
      />
    );
  }

  // Settings, logs - simple headers
  return <SimpleHeader title={view.type} onClose={onClose} />;
}

/**
 * Header for Plan view mode.
 * Shows plan name/title, no tabs, no streaming indicators.
 */
function PlanHeader({
  planId,
  onClose,
  onPopOut,
}: {
  planId: string;
  onClose: () => void;
  onPopOut?: () => void;
}) {
  const plan = usePlanStore(useCallback((s) => s.getPlan(planId), [planId]));
  const isMainWindow = useIsMainWindow();

  // Use the file name from relativePath, or truncated ID as fallback
  const planLabel =
    plan?.relativePath?.split("/").pop() ?? planId.slice(0, 8) + "...";

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1.5 text-xs">
        <button
          onClick={onClose}
          className="text-surface-400 hover:text-surface-200 focus:outline-none focus:text-surface-200 transition-colors"
        >
          plans
        </button>
        <ChevronRight size={12} className="text-surface-500" />
        <span className="text-surface-300 truncate max-w-[200px]">
          {planLabel}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Pop-out button - only show in panel windows, not main window */}
        {onPopOut && !isMainWindow && (
          <button
            onClick={onPopOut}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Pop out to window"
            title="Pop out to window"
          >
            <PictureInPicture2 size={12} />
          </button>
        )}
        {/* Close button */}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close pane"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

/**
 * Header for Thread view mode.
 * Shows status dot, breadcrumb, cancel button when streaming, tab toggle.
 */
function ThreadHeader({
  threadId,
  threadTab,
  onThreadTabChange,
  isStreaming,
  onClose,
  onPopOut,
}: {
  threadId: string;
  threadTab: "conversation" | "changes";
  onThreadTabChange?: (tab: "conversation" | "changes") => void;
  isStreaming: boolean;
  onClose: () => void;
  onPopOut?: () => void;
}) {
  const thread = useThreadStore(
    useCallback((s) => s.threads[threadId], [threadId])
  );
  const isMainWindow = useIsMainWindow();

  // Cancel agent via service (service encapsulates communication)
  const handleCancel = useCallback(async () => {
    // Import cancelAgent from agent-service dynamically to avoid tight coupling
    const { cancelAgent } = await import("@/lib/agent-service");
    await cancelAgent(threadId);
  }, [threadId]);

  const handleToggle = useCallback(() => {
    if (onThreadTabChange) {
      onThreadTabChange(
        threadTab === "conversation" ? "changes" : "conversation"
      );
    }
  }, [onThreadTabChange, threadTab]);

  // Display thread name/title, or "new" if no messages yet
  const threadLabel = (() => {
    // If thread has a name, use it
    if (thread?.name) {
      return thread.name;
    }
    // If no turns yet, show "new"
    if (!thread?.turns || thread.turns.length === 0) {
      return "new";
    }
    // Fallback to first user prompt if no name generated yet
    const firstTurn = thread.turns[0];
    if (!firstTurn?.prompt) {
      return "new";
    }
    // Truncate long messages for display in breadcrumb
    const maxLength = 50;
    if (firstTurn.prompt.length > maxLength) {
      return firstTurn.prompt.slice(0, maxLength) + "...";
    }
    return firstTurn.prompt;
  })();

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
      {/* Status dot */}
      <StatusDot variant={getStatusVariant(isStreaming, thread?.isRead)} />

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1.5 text-xs">
        <button
          onClick={onClose}
          className="text-surface-400 hover:text-surface-200 focus:outline-none focus:text-surface-200 transition-colors"
        >
          threads
        </button>
        <ChevronRight size={12} className="text-surface-500" />
        <span className="text-surface-300 truncate max-w-[300px]">
          {threadLabel}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
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
            aria-label={
              threadTab === "conversation"
                ? "View changes"
                : "View conversation"
            }
            title={
              threadTab === "conversation"
                ? "View changes"
                : "View conversation"
            }
          >
            {threadTab === "conversation" ? (
              <GitCompare size={12} />
            ) : (
              <MessageSquare size={12} />
            )}
          </button>
        )}

        {/* Pop-out button - only show in panel windows, not main window */}
        {onPopOut && !isMainWindow && (
          <button
            onClick={onPopOut}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Pop out to window"
            title="Pop out to window"
          >
            <PictureInPicture2 size={12} />
          </button>
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close pane"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

/**
 * Simple header for settings and logs views.
 * Uses py-1.5 to match TreePanelHeader's visual height (which has a taller MortLogo).
 */
function SimpleHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  const displayTitle = title.charAt(0).toUpperCase() + title.slice(1);

  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 border-b border-surface-700">
      <span className="text-surface-200 text-xs">{displayTitle}</span>

      <div className="ml-auto">
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close pane"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
