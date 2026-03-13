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

import { useCallback, useState, useEffect } from "react";
import {
  StopCircle,
  Loader2,
  X,
  GitCompare,
  MessageSquare,
  PictureInPicture2,
  Terminal,
  Archive,
  GitPullRequest,
} from "lucide-react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useTerminalSession, terminalSessionService } from "@/entities/terminal-sessions";
import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";
import { useIsMainWindow } from "@/components/main-window/main-window-context";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { usePullRequestStore } from "@/entities/pull-requests/store";
import { handleCreatePr } from "@/lib/pr-actions";
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

  if (view.type === "changes") {
    return (
      <ChangesHeader
        repoId={view.repoId}
        worktreeId={view.worktreeId}
        uncommittedOnly={view.uncommittedOnly}
        commitHash={view.commitHash}
        onClose={onClose}
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
  const { repoName, worktreeName } = useBreadcrumbContext(
    plan?.repoId,
    plan?.worktreeId
  );

  // Use the file name from relativePath, or truncated ID as fallback
  const planLabel =
    plan?.relativePath?.split("/").pop() ?? planId.slice(0, 8) + "...";

  return (
    <div data-testid="content-pane-header" className="@container flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
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
            data-testid="pop-out-button"
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
          data-testid="close-pane-button"
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

  // Cancel agent via service — optimistic UI swap to "cancelling" state
  const [isCancelling, setIsCancelling] = useState(false);

  // Reset cancelling state when streaming stops
  useEffect(() => {
    if (!isStreaming) setIsCancelling(false);
  }, [isStreaming]);

  const handleCancel = useCallback(async () => {
    setIsCancelling(true);
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
    <div data-testid="content-pane-header" className="@container flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
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
            disabled={isCancelling}
            className={`px-1.5 py-0.5 rounded transition-colors flex items-center gap-1 text-xs ${
              isCancelling
                ? "bg-surface-700/50 text-surface-400 cursor-not-allowed"
                : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
            }`}
            aria-label={isCancelling ? "Cancelling agent" : "Cancel agent"}
          >
            {isCancelling ? <Loader2 size={12} className="animate-spin" /> : <StopCircle size={12} />}
            {isCancelling ? "Cancelling..." : "Cancel"}
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
            data-testid="pop-out-button"
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
          data-testid="close-pane-button"
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
    <div data-testid="content-pane-header" className="flex items-center gap-2.5 px-3 py-1.5 border-b border-surface-700">
      <span className="text-surface-200 text-xs">{displayTitle}</span>

      <div className="ml-auto">
        <button
          data-testid="close-pane-button"
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
    <div data-testid="content-pane-header" className="@container flex items-center gap-2.5 pl-3 pr-2 py-2 border-b border-surface-700">
      <Breadcrumb
        repoName={repoName}
        worktreeName={worktreeName}
        category="files"
        itemLabel={fileName}
        onCategoryClick={onClose}
      />

      <div className="ml-auto">
        <button
          data-testid="close-pane-button"
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

  // Resolve repo from worktreeId
  const repoId = useRepoWorktreeLookupStore((s) =>
    session?.worktreeId ? s.getRepoIdByWorktreeId(session.worktreeId) : undefined
  );
  const { repoName, worktreeName } = useBreadcrumbContext(repoId, session?.worktreeId);

  // Terminal label: custom label > last command > directory name
  const itemLabel = session?.label ?? session?.lastCommand ?? session?.worktreePath?.split("/").pop() ?? "terminal";

  // Archive (kill) the terminal
  const handleArchive = useCallback(async () => {
    await terminalSessionService.archive(terminalId);
    onClose();
  }, [terminalId, onClose]);

  return (
    <div data-testid="content-pane-header" className="@container flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
      {/* Terminal icon */}
      <Terminal size={14} className="text-surface-400" />

      <Breadcrumb
        repoName={repoName}
        worktreeName={worktreeName}
        category="terminal"
        itemLabel={itemLabel}
        onCategoryClick={onClose}
      />

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
          data-testid="close-pane-button"
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

/**
 * Header for Changes view mode.
 * Breadcrumb format:
 * - All changes: repoName / worktreeName / changes / All Changes
 * - Uncommitted: repoName / worktreeName / changes / Uncommitted
 * - Single commit: repoName / worktreeName / changes / abc1234
 */
function ChangesHeader({
  repoId,
  worktreeId,
  uncommittedOnly,
  commitHash,
  onClose,
}: {
  repoId: string;
  worktreeId: string;
  uncommittedOnly?: boolean;
  commitHash?: string;
  onClose: () => void;
}) {
  const { repoName, worktreeName } = useBreadcrumbContext(repoId, worktreeId);
  const getWorktreePath = useRepoWorktreeLookupStore((s) => s.getWorktreePath);
  const existingPrs = usePullRequestStore((s) => s.getPrsByWorktree(worktreeId));
  const hasPr = existingPrs.length > 0;

  const itemLabel = (() => {
    if (commitHash) return commitHash.slice(0, 7);
    if (uncommittedOnly) return "Uncommitted";
    return "All Changes";
  })();

  const [isCreating, setIsCreating] = useState(false);

  const handlePrClick = useCallback(async () => {
    const worktreePath = getWorktreePath(repoId, worktreeId);
    setIsCreating(true);
    try {
      await handleCreatePr(repoId, worktreeId, worktreePath);
    } finally {
      setIsCreating(false);
    }
  }, [repoId, worktreeId, getWorktreePath]);

  return (
    <div data-testid="content-pane-header" className="@container flex items-center gap-2.5 pl-3 pr-2 py-2 border-b border-surface-700">
      <Breadcrumb
        repoName={repoName}
        worktreeName={worktreeName}
        category="changes"
        itemLabel={itemLabel}
        onCategoryClick={onClose}
      />

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={handlePrClick}
          disabled={isCreating}
          className={hasPr
            ? "flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-surface-300 hover:text-surface-100 hover:bg-surface-700 transition-colors"
            : "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-accent-500 text-accent-900 hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          }
          aria-label={hasPr ? "View pull request" : "Create pull request"}
        >
          {isCreating ? <Loader2 size={12} className="animate-spin" /> : <GitPullRequest size={12} />}
          {isCreating ? "Creating..." : hasPr ? "View PR" : "Create PR"}
        </button>
        <button
          data-testid="close-pane-button"
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
