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
  X,
  GitCompare,
  MessageSquare,
  PictureInPicture2,
  Terminal,
  Archive,
} from "lucide-react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useTerminalSession, terminalSessionService } from "@/entities/terminal-sessions";
import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";
import { useIsMainWindow } from "@/components/main-window/main-window-context";
import { Breadcrumb } from "./breadcrumb";
import { useBreadcrumbContext } from "./use-breadcrumb-context";
import { PullRequestHeader } from "./pull-request-header";
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

  if (view.type === "file") {
    return (
      <FileHeader
        filePath={view.filePath}
        repoId={view.repoId}
        worktreeId={view.worktreeId}
        onClose={onClose}
      />
    );
  }

  if (view.type === "terminal") {
    return (
      <TerminalHeader
        terminalId={view.terminalId}
        onClose={onClose}
      />
    );
  }

  if (view.type === "pull-request") {
    return (
      <PullRequestHeader prId={view.prId} onClose={onClose} onPopOut={onPopOut} />
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
  const { repoName, worktreeName } = useBreadcrumbContext(
    plan?.repoId,
    plan?.worktreeId
  );

  // Use the file name from relativePath, or truncated ID as fallback
  const planLabel =
    plan?.relativePath?.split("/").pop() ?? planId.slice(0, 8) + "...";

  return (
    <div className="@container flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
      <Breadcrumb
        repoName={repoName}
        worktreeName={worktreeName}
        category="plans"
        itemLabel={planLabel}
        onCategoryClick={onClose}
      />

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
  const { repoName, worktreeName } = useBreadcrumbContext(
    thread?.repoId,
    thread?.worktreeId
  );

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
    <div className="@container flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
      {/* Status dot */}
      <StatusDot variant={getStatusVariant(isStreaming, thread?.isRead)} />

      <Breadcrumb
        repoName={repoName}
        worktreeName={worktreeName}
        category="threads"
        itemLabel={threadLabel}
        onCategoryClick={onClose}
      />

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

/**
 * Header for File view mode.
 * Shows breadcrumb with file name, close button.
 */
function FileHeader({
  filePath,
  repoId,
  worktreeId,
  onClose,
}: {
  filePath: string;
  repoId?: string;
  worktreeId?: string;
  onClose: () => void;
}) {
  const { repoName, worktreeName } = useBreadcrumbContext(repoId, worktreeId);
  const fileName = filePath.split("/").pop() ?? "file";

  return (
    <div className="@container flex items-center gap-2.5 pl-3 pr-2 py-2 border-b border-surface-700">
      <Breadcrumb
        repoName={repoName}
        worktreeName={worktreeName}
        category="files"
        itemLabel={fileName}
        onCategoryClick={onClose}
      />

      <div className="ml-auto">
        <button
          onClick={onClose}
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close pane"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

/**
 * Header for Terminal view mode.
 * Shows terminal icon, working directory, close button, and archive button.
 * - Close hides the pane but keeps the terminal alive
 * - Archive kills the PTY process
 */
function TerminalHeader({
  terminalId,
  onClose,
}: {
  terminalId: string;
  onClose: () => void;
}) {
  const session = useTerminalSession(terminalId);

  // Get the directory name from the full path
  const dirName = session?.worktreePath?.split("/").pop() ?? "terminal";

  // Archive (kill) the terminal
  const handleArchive = useCallback(async () => {
    await terminalSessionService.archive(terminalId);
    onClose();
  }, [terminalId, onClose]);

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
      {/* Terminal icon */}
      <Terminal size={14} className="text-surface-400" />

      {/* Label */}
      <span className="text-surface-200 text-xs truncate">
        {session?.lastCommand ?? dirName}
      </span>

      {/* Status indicator */}
      {session && !session.isAlive && (
        <span className="text-xs text-surface-500">(exited)</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Archive button - kills the PTY */}
        <button
          onClick={handleArchive}
          className="p-1 rounded hover:bg-red-600/20 text-surface-400 hover:text-red-400 transition-colors"
          aria-label="Archive terminal (kill process)"
          title="Archive terminal (kill process)"
        >
          <Archive size={12} />
        </button>

        {/* Close button - hides pane but keeps terminal alive */}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close pane (terminal stays alive)"
          title="Close pane (terminal stays alive)"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
