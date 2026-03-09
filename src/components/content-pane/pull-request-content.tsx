/**
 * PullRequestContent
 *
 * Main PR content pane component. Assembles all sub-components:
 * - Info section (title, state, author, branches, labels)
 * - Description section (body rendered as markdown)
 * - Checks section (CI check runs)
 * - Reviews section
 * - Comments section (inline review comments)
 * - Auto-address toggle (pinned at bottom)
 *
 * Fetches PR details on mount via the pull request service.
 */

import { useCallback, useEffect } from "react";
import { usePullRequestStore } from "@/entities/pull-requests/store";
import { pullRequestService } from "@/entities/pull-requests/service";
import { PrInfoSection } from "./pr-info-section";
import { PrDescriptionSection } from "./pr-description-section";
import { PrChecksSection } from "./pr-checks-section";
import { PrCommentsSection } from "./pr-comments-section";
import { PrMergeSection } from "./pr-merge-section";
import { PrAutoAddressToggle } from "./pr-auto-address-toggle";
import type { PullRequestContentProps } from "./types";

export function PullRequestContent({ prId, onPopOut: _onPopOut }: PullRequestContentProps) {
  void _onPopOut;

  const pr = usePullRequestStore(useCallback((s) => s.getPr(prId), [prId]));
  const details = usePullRequestStore(useCallback((s) => s.getPrDetails(prId), [prId]));
  const isLoading = usePullRequestStore(
    useCallback((s) => s.prDetailsLoading[prId] ?? false, [prId]),
  );

  // Fetch details on mount
  useEffect(() => {
    pullRequestService.fetchDetails(prId);
  }, [prId]);

  // First load: show skeleton
  if (isLoading && !details) {
    return <PrLoadingSkeleton />;
  }

  // Failed to load and no cached data
  if (!details && !isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="text-surface-500 text-sm text-center py-8">
          Failed to load PR details
        </div>
      </div>
    );
  }

  return (
    <div data-testid="pr-content" className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto pt-8">
        <div className="max-w-[900px] mx-auto p-4 space-y-3">
          {details && pr && (
            <>
              <PrInfoSection
                details={details}
                prNumber={pr.prNumber}
                url={details.url}
                headBranch={pr.headBranch}
                baseBranch={pr.baseBranch}
                reviewDecision={details.reviewDecision}
              />
              <PrDescriptionSection body={details.body} />
              <PrChecksSection checks={details.checks} />
              <PrMergeSection
                prId={pr.id}
                repoSlug={pr.repoSlug}
                state={details.state}
                isDraft={details.isDraft}
              />
              <PrCommentsSection comments={details.reviewComments} />
            </>
          )}
        </div>
      </div>
      {/* Auto-address toggle pinned at bottom */}
      {pr && (
        <PrAutoAddressToggle
          prId={pr.id}
          autoAddressEnabled={pr.autoAddressEnabled}
          repoId={pr.repoId}
        />
      )}
    </div>
  );
}

/**
 * Loading skeleton shown during the first fetch.
 * Subsequent refreshes show stale data (stale-while-revalidate).
 */
function PrLoadingSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="max-w-[900px] mx-auto p-4 space-y-3 w-full animate-pulse">
        {/* Title placeholder */}
        <div className="space-y-2">
          <div className="h-7 bg-surface-700 rounded w-3/4" />
          <div className="h-4 bg-surface-700 rounded w-1/3" />
        </div>
        {/* Description card placeholder */}
        <div className="bg-surface-800/30 rounded-lg p-4 space-y-2">
          <div className="h-4 bg-surface-700 rounded w-1/4" />
          <div className="h-3 bg-surface-700 rounded w-full" />
          <div className="h-3 bg-surface-700 rounded w-5/6" />
          <div className="h-3 bg-surface-700 rounded w-2/3" />
        </div>
        {/* Checks card placeholder */}
        <div className="bg-surface-800/30 rounded-lg p-4 space-y-2">
          <div className="h-4 bg-surface-700 rounded w-1/4" />
          <div className="h-3 bg-surface-700 rounded w-1/2" />
          <div className="h-3 bg-surface-700 rounded w-1/2" />
        </div>
      </div>
    </div>
  );
}
