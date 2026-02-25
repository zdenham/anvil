/**
 * Event helper functions for PR entity listeners.
 *
 * Pure functions for classifying, extracting, debouncing, and building
 * context from GitHub webhook events. Extracted from listeners.ts to
 * keep that file under the 250-line limit and make logic testable.
 */

import type { PullRequestMetadata, PullRequestDetails } from "./types";
import type { GhCli } from "@/lib/gh-cli";

// ═══════════════════════════════════════════════════════════════════════════
// PR Action Types
// ═══════════════════════════════════════════════════════════════════════════

export type PrAction =
  | { type: "ci-failure" }
  | { type: "review-submitted" }
  | { type: "pr-comment" };

// ═══════════════════════════════════════════════════════════════════════════
// PR Number Extraction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract the PR number from a webhook payload based on event type.
 * Returns null if the PR number cannot be determined (event is silently dropped).
 */
export function extractPrNumber(
  eventType: string,
  payload: Record<string, unknown>,
): number | null {
  switch (eventType) {
    case "pull_request_review": {
      const pr = payload.pull_request as Record<string, unknown> | undefined;
      return typeof pr?.number === "number" ? pr.number : null;
    }
    case "issue_comment": {
      const issue = payload.issue as Record<string, unknown> | undefined;
      if (!issue?.pull_request) return null;
      return typeof issue?.number === "number" ? issue.number : null;
    }
    case "check_run": {
      const checkRun = payload.check_run as Record<string, unknown> | undefined;
      const prs = checkRun?.pull_requests as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(prs) || prs.length === 0) return null;
      return typeof prs[0]?.number === "number" ? prs[0].number : null;
    }
    case "check_suite": {
      const checkSuite = payload.check_suite as Record<string, unknown> | undefined;
      const prs = checkSuite?.pull_requests as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(prs) || prs.length === 0) return null;
      return typeof prs[0]?.number === "number" ? prs[0].number : null;
    }
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Classification
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classify a GitHub webhook event into an actionable PrAction type.
 * Returns null for events that should not trigger any action (wrong action,
 * passing checks, etc.).
 */
export function classifyGithubEvent(
  eventType: string,
  payload: Record<string, unknown>,
): PrAction | null {
  switch (eventType) {
    case "check_run": {
      if (payload.action !== "completed") return null;
      const checkRun = payload.check_run as Record<string, unknown> | undefined;
      const conclusion = checkRun?.conclusion;
      if (conclusion !== "failure" && conclusion !== "timed_out") return null;
      return { type: "ci-failure" };
    }
    case "check_suite": {
      if (payload.action !== "completed") return null;
      const checkSuite = payload.check_suite as Record<string, unknown> | undefined;
      const conclusion = checkSuite?.conclusion;
      if (conclusion !== "failure" && conclusion !== "timed_out") return null;
      return { type: "ci-failure" };
    }
    case "pull_request_review": {
      if (payload.action !== "submitted") return null;
      return { type: "review-submitted" };
    }
    case "issue_comment": {
      if (payload.action !== "created") return null;
      return { type: "pr-comment" };
    }
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Debouncing
// ═══════════════════════════════════════════════════════════════════════════

const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS: Record<PrAction["type"], number> = {
  "ci-failure": 30_000,
  "review-submitted": 5_000,
  "pr-comment": 5_000,
};

/**
 * Per-PR + action-type debouncing.
 * CI events use a 30s window (let the full suite finish).
 * Review/comment events use a 5s window (catches rapid-fire while staying responsive).
 */
export function debounceAutoAddress(
  prId: string,
  action: PrAction,
  fn: () => void,
): void {
  const key = `${prId}:${action.type}`;
  const existing = debounceMap.get(key);
  if (existing) clearTimeout(existing);
  debounceMap.set(
    key,
    setTimeout(() => {
      debounceMap.delete(key);
      fn();
    }, DEBOUNCE_MS[action.type]),
  );
}

/** Clear all pending debounce timers. Used in tests. */
export function clearAllDebounceTimers(): void {
  for (const timer of debounceMap.values()) {
    clearTimeout(timer);
  }
  debounceMap.clear();
}

// ═══════════════════════════════════════════════════════════════════════════
// Fresh Context Fetching
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Query the gh CLI for current data based on the action type.
 * Events are signals, not data -- the webhook payload is never passed to the agent.
 */
export async function fetchFreshContext(
  ghCli: GhCli,
  prNumber: number,
  action: PrAction,
): Promise<string> {
  switch (action.type) {
    case "ci-failure": {
      const checks = await ghCli.getPrChecks(prNumber);
      const failing = checks.filter(
        (c: PullRequestDetails["checks"][number]) =>
          c.status === "fail" || c.conclusion === "failure" || c.conclusion === "timed_out",
      );
      return failing
        .map(
          (c: PullRequestDetails["checks"][number]) =>
            `- ${c.name}: ${c.conclusion ?? "unknown"} (${c.url ?? "no link"})`,
        )
        .join("\n");
    }
    case "review-submitted": {
      const comments = await ghCli.getPrComments(prNumber);
      const unresolved = comments.filter(
        (c: PullRequestDetails["reviewComments"][number]) => !c.isResolved,
      );
      return unresolved
        .map(
          (c: PullRequestDetails["reviewComments"][number]) =>
            `- ${c.author} on ${c.path ?? "?"}:${c.line ?? "?"}: ${c.body}`,
        )
        .join("\n\n");
    }
    case "pr-comment": {
      const details = await ghCli.getPrDetails(prNumber);
      const recentReviews = details.reviews?.slice(-3) ?? [];
      return `Recent comments:\n${JSON.stringify(recentReviews, null, 2)}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Prompt Building
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the prompt string that spawns the agent with the appropriate skill.
 */
export function buildAutoAddressPrompt(
  pr: PullRequestMetadata,
  action: PrAction,
  context: string,
): string {
  switch (action.type) {
    case "ci-failure":
      return `/mort:fix-ci\n\nPR #${pr.prNumber} on ${pr.repoSlug}\nBranch: ${pr.headBranch}\n\nFailing checks:\n${context}`;
    case "pr-comment":
    case "review-submitted":
      return `/mort:address-pr-comment\n\nPR #${pr.prNumber} on ${pr.repoSlug}\nBranch: ${pr.headBranch}\n\nReview comments to address:\n${context}`;
  }
}

/**
 * Generate a descriptive thread name for the auto-address agent.
 */
export function threadName(action: PrAction, prNumber: number): string {
  switch (action.type) {
    case "ci-failure":
      return `Fix CI on PR #${prNumber}`;
    case "review-submitted":
      return `Address review on PR #${prNumber}`;
    case "pr-comment":
      return `Respond to comment on PR #${prNumber}`;
  }
}
