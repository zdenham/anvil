/**
 * PullRequestHeader
 *
 * Header sub-component for pull request content panes.
 * Displays status dot, breadcrumb, refresh, open-in-browser, pop-out, and close buttons.
 */

import { useCallback } from "react";
import { RefreshCw, ExternalLink, PictureInPicture2, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePullRequestStore } from "@/entities/pull-requests/store";
import { pullRequestService } from "@/entities/pull-requests/service";
import { StatusDot } from "@/components/ui/status-dot";
import { derivePrStatusDot } from "@/utils/pr-status";
import { useIsMainWindow } from "@/components/main-window/main-window-context";
import { Breadcrumb } from "./breadcrumb";
import { useBreadcrumbContext } from "./use-breadcrumb-context";

export function PullRequestHeader({
  prId,
  onClose,
  onPopOut,
}: {
  prId: string;
  onClose: () => void;
  onPopOut?: () => void;
}) {
  const pr = usePullRequestStore(useCallback((s) => s.getPr(prId), [prId]));
  const details = usePullRequestStore(useCallback((s) => s.getPrDetails(prId), [prId]));
  const isMainWindow = useIsMainWindow();
  const { repoName, worktreeName } = useBreadcrumbContext(pr?.repoId, pr?.worktreeId);

  const prLabel = details
    ? `PR #${pr?.prNumber}: ${details.title}`
    : `PR #${pr?.prNumber ?? "..."}`;

  const handleRefresh = useCallback(async () => {
    await pullRequestService.fetchDetails(prId);
  }, [prId]);

  const handleOpenInBrowser = useCallback(() => {
    if (details?.url) {
      openUrl(details.url);
    }
  }, [details?.url]);

  return (
    <div className="@container flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
      <StatusDot variant={derivePrStatusDot(details)} />
      <Breadcrumb
        repoName={repoName}
        worktreeName={worktreeName}
        category="pull-requests"
        itemLabel={prLabel}
        onCategoryClick={onClose}
      />
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={handleRefresh}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Refresh PR data"
          title="Refresh PR data"
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={handleOpenInBrowser}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Open in browser"
          title="Open in browser"
        >
          <ExternalLink size={12} />
        </button>
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
