import type { StatusDotVariant } from "@/components/ui/status-dot";
import type { PullRequestDetails } from "@/entities/pull-requests/types";

/**
 * Derive StatusDotVariant from cached PullRequestDetails.
 * Maps PR state to existing status dot variants:
 * - "read" (grey): merged, closed, or no details loaded
 * - "unread" (blue): draft PR
 * - "stale" (amber): failing checks or changes requested
 * - "running" (green): pending checks
 */
export function derivePrStatusDot(
  details: PullRequestDetails | undefined,
): StatusDotVariant {
  if (!details) return "read";
  if (details.state === "MERGED") return "read";
  if (details.state === "CLOSED") return "read";
  if (details.isDraft) return "unread";

  const hasFailingChecks = details.checks.some((c) => c.status === "fail");
  const hasChangesRequested =
    details.reviewDecision === "CHANGES_REQUESTED";
  if (hasFailingChecks || hasChangesRequested) return "stale";

  const hasPendingChecks = details.checks.some((c) => c.status === "pending");
  if (hasPendingChecks) return "running";

  return "read";
}
