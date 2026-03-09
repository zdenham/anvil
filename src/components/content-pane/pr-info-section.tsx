/**
 * PrInfoSection
 *
 * Displays PR metadata: title, number, state badge, author, branch info, and labels.
 */

import { GitBranch } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PullRequestDetails } from "@/entities/pull-requests/types";

interface PrInfoSectionProps {
  details: PullRequestDetails;
  prNumber: number;
  url: string;
  headBranch: string;
  baseBranch: string;
  reviewDecision: PullRequestDetails["reviewDecision"];
}

function StateBadge({ state, isDraft }: { state: string; isDraft: boolean }) {
  if (isDraft) {
    return (
      <span className="px-1.5 py-0.5 text-xs rounded bg-surface-700 text-surface-300">
        Draft
      </span>
    );
  }
  if (state === "MERGED") {
    return (
      <span className="px-1.5 py-0.5 text-xs rounded bg-purple-600/20 text-purple-400">
        Merged
      </span>
    );
  }
  if (state === "CLOSED") {
    return (
      <span className="px-1.5 py-0.5 text-xs rounded bg-red-600/20 text-red-400">
        Closed
      </span>
    );
  }
  return (
    <span className="px-1.5 py-0.5 text-xs rounded bg-green-600/20 text-green-400">
      Open
    </span>
  );
}

function ReviewDecisionBadge({ decision }: { decision: PullRequestDetails["reviewDecision"] }) {
  if (decision === "APPROVED") {
    return (
      <span className="px-1.5 py-0.5 text-xs rounded bg-green-600/20 text-green-400">
        Approved
      </span>
    );
  }
  if (decision === "CHANGES_REQUESTED") {
    return (
      <span className="px-1.5 py-0.5 text-xs rounded bg-red-600/20 text-red-400">
        Changes requested
      </span>
    );
  }
  // REVIEW_REQUIRED or null — default to "Needs review"
  return (
    <span className="px-1.5 py-0.5 text-xs rounded bg-blue-600/20 text-blue-400">
      Needs review
    </span>
  );
}

export function PrInfoSection({ details, prNumber, url, headBranch, baseBranch, reviewDecision }: PrInfoSectionProps) {
  return (
    <div className="space-y-2">
      {/* Title row */}
      <div className="flex items-start gap-3">
        <h2 className="text-2xl font-bold font-mono text-surface-100 leading-snug">
          {details.title}
        </h2>
        <button
          onClick={() => openUrl(url)}
          className="text-xl font-mono text-surface-500 mt-0.5 shrink-0 hover:underline hover:text-surface-300 transition-colors"
        >
          #{prNumber}
        </button>
      </div>

      {/* State and branch info */}
      <div className="flex items-center gap-2 flex-wrap">
        <StateBadge state={details.state} isDraft={details.isDraft} />
        <ReviewDecisionBadge decision={reviewDecision} />
        <div className="flex items-center gap-1.5 text-xs text-surface-400">
          <GitBranch size={12} className="shrink-0" />
          <span className="truncate max-w-[200px]">origin/{baseBranch}</span>
          <span className="text-surface-600">&larr;</span>
          <span className="truncate max-w-[200px]">{headBranch}</span>
        </div>
      </div>

      {/* Labels */}
      {details.labels.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {details.labels.map((label) => (
            <span
              key={label}
              className="px-1.5 py-0.5 text-xs rounded bg-surface-700 text-surface-300"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
