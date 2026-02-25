/**
 * Gateway event handler for PR entity.
 *
 * Receives GITHUB_WEBHOOK_EVENT events forwarded by the gateway channel
 * listeners (D1), processes them for the PR entity. The actual event
 * subscription will be added by D2, which calls into this handler.
 *
 * Two stages:
 * 1. Always: Refresh cached PullRequestDetails in the store for the
 *    affected PR, so side panel status dots and content pane stay current.
 * 2. Conditionally: If autoAddressEnabled is true, spawn an agent to
 *    address the event (implemented in pr-auto-address sub-plan D2).
 */

import type { GatewayEvent } from "@core/types/gateway-events.js";
import { pullRequestService } from "./service";
import { usePullRequestStore } from "./store";
import { logger } from "@/lib/logger-client";

/**
 * Handle a gateway event that may relate to a PR.
 *
 * Event classification and filtering:
 * - pull_request.opened: Create PR entity if not exists, refresh details
 * - pull_request.closed: Refresh details, auto-disable auto-address
 * - pull_request.synchronize: Refresh details
 * - issue_comment: Refresh details, conditionally spawn agent
 * - pull_request_review: Refresh details, conditionally spawn agent
 * - pull_request_review_comment: Refresh details, conditionally spawn agent
 * - check_run / check_suite: Only process when conclusion is "failure" or
 *   "timed_out". Refresh details, conditionally spawn CI fix agent.
 */
export async function handlePrGatewayEvent(
  event: GatewayEvent,
  repoId: string,
): Promise<void> {
  const prNumber = extractPrNumber(event);
  if (prNumber === null) return;

  // Stage 1: Always refresh display data for the affected PR
  const pr = usePullRequestStore
    .getState()
    .getPrByRepoAndNumber(repoId, prNumber);
  if (pr) {
    await pullRequestService.fetchDetails(pr.id);
  }

  // Handle PR closed/merged: auto-disable auto-address
  if (event.type === "github.pull_request" && isPrClosedEvent(event)) {
    if (pr?.autoAddressEnabled) {
      await pullRequestService.disableAutoAddress(pr.id);
      logger.info(
        `[handlePrGatewayEvent] Auto-disabled auto-address for closed PR ${pr.id}`,
      );
    }
    return;
  }

  // Stage 2: Conditionally spawn agent if auto-address is enabled
  if (!pr?.autoAddressEnabled) return;

  // Event-specific agent spawning (implemented in pr-auto-address sub-plan D2)
  // - issue_comment: Agent uses discretion
  // - check_run with failure: Verify conclusion is "failure" or "timed_out"
  // - pull_request_review: Spawn address-pr-comment agent
  logger.debug(
    `[handlePrGatewayEvent] Auto-address event for PR ${pr.id}: ${event.type}`,
  );
}

/**
 * Extract PR number from a gateway event payload.
 * Returns null if the event doesn't contain a PR number.
 */
function extractPrNumber(event: GatewayEvent): number | null {
  const payload = event.payload;

  // pull_request events
  if (event.type.startsWith("github.pull_request")) {
    const pr = payload.pull_request as
      | { number?: number }
      | undefined;
    if (pr?.number) return pr.number;
    const num = payload.number as number | undefined;
    if (num) return num;
  }

  // issue_comment events on PRs
  if (event.type === "github.issue_comment") {
    const issue = payload.issue as
      | { pull_request?: unknown; number?: number }
      | undefined;
    if (issue?.pull_request && issue?.number) return issue.number;
  }

  // pull_request_review and pull_request_review_comment
  if (
    event.type === "github.pull_request_review" ||
    event.type === "github.pull_request_review_comment"
  ) {
    const pr = payload.pull_request as
      | { number?: number }
      | undefined;
    if (pr?.number) return pr.number;
  }

  // check_run events (may have empty pull_requests array for fork PRs)
  if (event.type === "github.check_run") {
    const checkRun = payload.check_run as
      | { pull_requests?: Array<{ number?: number }> }
      | undefined;
    const firstPr = checkRun?.pull_requests?.[0];
    if (firstPr?.number) return firstPr.number;
  }

  // check_suite events
  if (event.type === "github.check_suite") {
    const checkSuite = payload.check_suite as
      | { pull_requests?: Array<{ number?: number }> }
      | undefined;
    const firstPr = checkSuite?.pull_requests?.[0];
    if (firstPr?.number) return firstPr.number;
  }

  return null;
}

/**
 * Check if a pull_request event is a closed/merged event.
 */
function isPrClosedEvent(event: GatewayEvent): boolean {
  return (event.payload.action as string | undefined) === "closed";
}
