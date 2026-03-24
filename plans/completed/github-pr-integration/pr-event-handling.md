# D2: PR Event Handling, Auto-Address Logic & Skills

Implements the PR entity event listeners that consume `GITHUB_WEBHOOK_EVENT` events from the gateway channel system, classify them, refresh display data, debounce, and spawn auto-address agents. Also implements the two bundled skills (`address-pr-comment`, `fix-ci`) that the spawned agents use, and wires up the auto-address toggle on the PR entity.

**Parent plan:** [pr-auto-address.md](./pr-auto-address.md) (Phases 3-5)
**Depends on:**
- A (PR entity & GhCli -- `PullRequestMetadata`, `pullRequestService`, `GhCli` class)
- B (PR UI -- content pane with toggle placeholder)
- D1 ([pr-gateway-channels.md](./pr-gateway-channels.md) -- `GITHUB_WEBHOOK_EVENT` events flowing, `gatewayChannelService`)

## File Summary

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `src/entities/pull-requests/event-helpers.ts` | CREATE | `extractPrNumber`, `classifyGithubEvent`, `debounceAutoAddress`, `fetchFreshContext`, `buildAutoAddressPrompt` |
| 2 | `src/entities/pull-requests/listeners.ts` | MODIFY | Add `GITHUB_WEBHOOK_EVENT` handler for display updates + auto-address agent spawning |
| 3 | `src/entities/index.ts` | MODIFY | Ensure `setupPullRequestListeners()` is called (may already be wired from plan A) |
| 4 | `plugins/anvil/skills/address-pr-comment/SKILL.md` | CREATE | Skill for addressing review comments on a PR |
| 5 | `plugins/anvil/skills/fix-ci/SKILL.md` | CREATE | Skill for investigating and fixing CI failures |
| 6 | `core/types/pull-request.ts` | MODIFY | Ensure `autoAddressEnabled` and `gatewayChannelId` fields exist on `PullRequestMetadataSchema` (may already be there from plan A) |

## Phases

- [x] Create event helper functions (classification, extraction, debouncing, context fetching)
- [x] Implement GITHUB_WEBHOOK_EVENT listener in PR entity listeners
- [x] Create address-pr-comment skill
- [x] Create fix-ci skill
- [x] Wire up auto-address toggle enable/disable flow
- [x] Verify end-to-end event flow with tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Event Helper Functions

### File: `src/entities/pull-requests/event-helpers.ts` (CREATE)

This file contains all the pure helper functions used by the PR entity listener. Extracting these keeps `listeners.ts` under the 250-line limit and makes the logic independently testable.

#### PR Number Extraction

Extracts the PR number from the webhook payload based on event type. Returns `null` if the PR number cannot be determined (event is silently dropped).

```typescript
export function extractPrNumber(
  eventType: string,
  payload: Record<string, unknown>,
): number | null {
  switch (eventType) {
    case "pull_request_review":
    case "pull_request_review_comment": {
      // payload.pull_request.number
      const pr = payload.pull_request as Record<string, unknown> | undefined;
      return typeof pr?.number === "number" ? pr.number : null;
    }
    case "issue_comment": {
      // Only PR comments (payload.issue.pull_request exists)
      const issue = payload.issue as Record<string, unknown> | undefined;
      if (!issue?.pull_request) return null;
      return typeof issue?.number === "number" ? issue.number : null;
    }
    case "check_run": {
      // payload.check_run.pull_requests[0]?.number (may be empty array for fork PRs)
      const checkRun = payload.check_run as Record<string, unknown> | undefined;
      const prs = checkRun?.pull_requests as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(prs) || prs.length === 0) return null;
      return typeof prs[0]?.number === "number" ? prs[0].number : null;
    }
    case "check_suite": {
      // payload.check_suite.pull_requests[0]?.number (may be empty array)
      const checkSuite = payload.check_suite as Record<string, unknown> | undefined;
      const prs = checkSuite?.pull_requests as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(prs) || prs.length === 0) return null;
      return typeof prs[0]?.number === "number" ? prs[0].number : null;
    }
    default:
      return null;
  }
}
```

#### Event Classification

Classifies a GitHub webhook event into an actionable `PrAction` type. Returns `null` for events that should not trigger any action (wrong action, passing checks, etc.).

```typescript
export type PrAction =
  | { type: "ci-failure" }
  | { type: "review-submitted" }
  | { type: "review-comment" }
  | { type: "pr-comment" };

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
    case "pull_request_review_comment": {
      if (payload.action !== "created") return null;
      return { type: "review-comment" };
    }
    case "issue_comment": {
      if (payload.action !== "created") return null;
      return { type: "pr-comment" };
    }
    default:
      return null;
  }
}
```

#### Debouncing

Per-PR + action-type debouncing with different windows:
- **CI events (30s):** Lets the full CI suite finish before spawning a fix agent
- **Review/comment events (5s):** Catches rapid-fire comments while staying responsive

```typescript
const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS: Record<PrAction["type"], number> = {
  "ci-failure": 30_000,
  "review-submitted": 5_000,
  "review-comment": 5_000,
  "pr-comment": 5_000,
};

export function debounceAutoAddress(
  prId: string,
  action: PrAction,
  fn: () => void,
): void {
  const key = `${prId}:${action.type}`;
  const existing = debounceMap.get(key);
  if (existing) clearTimeout(existing);
  debounceMap.set(key, setTimeout(() => {
    debounceMap.delete(key);
    fn();
  }, DEBOUNCE_MS[action.type]));
}
```

#### Fresh Context Fetching

Queries the `gh` CLI for current data based on the action type. Events are signals, not data -- the webhook payload is never passed to the agent.

```typescript
export async function fetchFreshContext(
  ghCli: GhCli,
  prNumber: number,
  action: PrAction,
): Promise<string> {
  switch (action.type) {
    case "ci-failure": {
      const checks = await ghCli.getPrChecks(prNumber);
      const failing = checks.filter((c: { status: string; conclusion?: string }) =>
        c.status === "fail" || c.conclusion === "failure" || c.conclusion === "timed_out"
      );
      return failing
        .map((c: { name: string; conclusion?: string; url?: string }) =>
          `- ${c.name}: ${c.conclusion ?? "unknown"} (${c.url ?? "no link"})`
        )
        .join("\n");
    }
    case "review-comment":
    case "review-submitted": {
      const comments = await ghCli.getPrComments(prNumber);
      const unresolved = comments.filter((c: { isResolved?: boolean }) => !c.isResolved);
      return unresolved
        .map((c: { author: string; path?: string; line?: number; body: string }) =>
          `- ${c.author} on ${c.path ?? "?"}:${c.line ?? "?"}: ${c.body}`
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
```

**Note on GhCli types:** The `GhCli` class and its return types (`PullRequestDetails`, check/comment structures) are defined in plan A (`pr-entity.md`). Import them from wherever plan A places the class (likely `src/lib/gh-cli.ts`). If plan A is not yet implemented, use loose typing with inline annotations and add a TODO to tighten types.

#### Auto-Address Prompt Builder

Builds the prompt string that spawns the agent with the appropriate skill:

```typescript
export function buildAutoAddressPrompt(
  pr: PullRequestMetadata,
  action: PrAction,
  context: string,
): string {
  switch (action.type) {
    case "ci-failure":
      return `/fix-ci\n\nPR #${pr.prNumber} on ${pr.repoSlug}\nBranch: ${pr.headBranch}\n\nFailing checks:\n${context}`;
    case "review-comment":
    case "pr-comment":
    case "review-submitted":
      return `/address-pr-comment\n\nPR #${pr.prNumber} on ${pr.repoSlug}\nBranch: ${pr.headBranch}\n\nReview comments to address:\n${context}`;
  }
}

export function threadName(action: PrAction, prNumber: number): string {
  switch (action.type) {
    case "ci-failure": return `Fix CI on PR #${prNumber}`;
    case "review-comment": return `Address review on PR #${prNumber}`;
    case "review-submitted": return `Address review on PR #${prNumber}`;
    case "pr-comment": return `Respond to comment on PR #${prNumber}`;
  }
}
```

**File should stay under 250 lines.** If it grows, split into `event-classifiers.ts` (extract/classify) and `event-context.ts` (fetch/prompt).

---

## Phase 2: PR Entity Listener for Gateway Events

### File: `src/entities/pull-requests/listeners.ts` (MODIFY)

The gateway channel listeners (D1) route raw `GATEWAY_EVENT` → `GITHUB_WEBHOOK_EVENT`. The PR entity's `listeners.ts` subscribes to `GITHUB_WEBHOOK_EVENT` and handles the actual event processing — classification, display updates, and agent spawning. For PR lifecycle events (`pull_request` type), the handler in plan C creates/closes PR entities. For all other events, the handler in this plan does display updates and auto-address.

**Add to the existing `setupPullRequestListeners()` function:**

```typescript
import { EventName } from "@core/types/events.js";
import { eventBus } from "../events";
import { gatewayChannelService } from "../gateway-channels";
import { pullRequestService } from "./service";
import { usePullRequestStore } from "./store";
import { GhCli } from "@/lib/gh-cli"; // from plan A
import { createThread } from "@/lib/thread-creation-service";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { logger } from "@/lib/logger-client";
import {
  extractPrNumber,
  classifyGithubEvent,
  debounceAutoAddress,
  fetchFreshContext,
  buildAutoAddressPrompt,
  type PrAction,
} from "./event-helpers";

export function setupPullRequestListeners(): void {
  // ... existing PR lifecycle listeners (THREAD_CREATED, etc.) from plan A ...

  // ================================================================
  // Gateway Event Handling: Display Updates + Auto-Address
  // ================================================================

  eventBus.on(EventName.GITHUB_WEBHOOK_EVENT, async ({ channelId, githubEventType, payload }) => {
    // pull_request events handled separately for PR creation/close detection (plan C)
    if (githubEventType === "pull_request") return;

    // 1. Resolve channel to repo
    const channel = gatewayChannelService.get(channelId);
    if (!channel?.repoId) return;

    // 2. Extract PR number from payload
    const prNumber = extractPrNumber(githubEventType, payload);
    if (!prNumber) return;

    // 3. Find the PR entity
    const pr = pullRequestService.getByRepoAndNumber(channel.repoId, prNumber);
    if (!pr) return;

    // 4. Classify the event
    const action = classifyGithubEvent(githubEventType, payload);
    if (!action) return;

    // -- Stage 1: Display Update (always, for all PRs) ---------------
    await refreshPrDisplayData(pr, action);

    // -- Stage 2: Agent Spawn (only if auto-address enabled) ---------
    if (!pr.autoAddressEnabled) return;

    debounceAutoAddress(pr.id, action, async () => {
      try {
        await spawnAutoAddressAgent(pr, action);
      } catch (e) {
        logger.error(`[PrListener] Failed to spawn auto-address agent for PR #${pr.prNumber}:`, e);
      }
    });
  });
}
```

**Display data refresh helper (within listeners.ts or extracted):**

```typescript
async function refreshPrDisplayData(
  pr: PullRequestMetadata,
  action: PrAction,
): Promise<void> {
  // Get the worktree path for gh CLI
  const worktreePath = useRepoWorktreeLookupStore.getState().getWorktreePath(pr.repoId, pr.worktreeId);
  if (!worktreePath) return;

  const ghCli = new GhCli(worktreePath);
  try {
    if (action.type === "ci-failure") {
      const checks = await ghCli.getPrChecks(pr.prNumber);
      const existing = usePullRequestStore.getState().getPrDetails(pr.id);
      if (existing) {
        usePullRequestStore.getState().setPrDetails(pr.id, { ...existing, checks });
      }
    } else {
      const details = await ghCli.getPrDetails(pr.prNumber);
      usePullRequestStore.getState().setPrDetails(pr.id, details);
    }
  } catch (e) {
    // Display update failure is non-fatal -- do not block agent spawn
    logger.warn(`[PrListener] Failed to refresh display data for PR #${pr.prNumber}:`, e);
  }
}
```

**Agent spawn helper:**

```typescript
async function spawnAutoAddressAgent(
  pr: PullRequestMetadata,
  action: PrAction,
): Promise<void> {
  const worktreePath = useRepoWorktreeLookupStore.getState().getWorktreePath(pr.repoId, pr.worktreeId);
  if (!worktreePath) return;

  const ghCli = new GhCli(worktreePath);
  const context = await fetchFreshContext(ghCli, pr.prNumber, action);
  const prompt = buildAutoAddressPrompt(pr, action, context);

  // Permission mode is a user setting (default: "approve")
  const permissionMode = getAutoAddressPermissionMode();

  await createThread({
    prompt,
    repoId: pr.repoId,
    worktreeId: pr.worktreeId,
    worktreePath,
    permissionMode,
  });

  logger.info(`[PrListener] Spawned auto-address agent for PR #${pr.prNumber}: ${action.type}`);
}
```

**Permission mode helper:**

```typescript
import type { PermissionModeId } from "@core/types/permissions.js";

function getAutoAddressPermissionMode(): PermissionModeId {
  // TODO: Read from user settings once the auto-address settings UI is implemented.
  // For now, default to "approve" (agents wait for user approval on each tool call).
  // Users who want hands-free automation can override by adding
  // autoAddressPermissionMode to their workspace settings.
  return "approve";
}
```

**Note on worktree path lookup:** Uses `useRepoWorktreeLookupStore.getState().getWorktreePath(repoId, worktreeId)` to resolve the filesystem path. This store is hydrated at startup from `RepositorySettings` and provides an in-memory lookup.

### File: `src/entities/index.ts` (MODIFY -- if needed)

If `setupPullRequestListeners()` is not yet called in `setupEntityListeners()`, add it:

```typescript
import { setupPullRequestListeners } from "./pull-requests/listeners";

// In setupEntityListeners():
setupPullRequestListeners();
```

Also ensure `pullRequestService.hydrate()` is called in `hydrateEntities()` if not already done by plan A.

---

## Phase 3: Address PR Comment Skill

### File: `plugins/anvil/skills/address-pr-comment/SKILL.md` (CREATE)

```markdown
---
name: Address PR Comment
description: Addresses a review comment on a pull request
user-invocable: false
allowed-tools: bash,read,edit,write,grep,glob
---

You are addressing a review comment on a pull request. The comment details
and file context are provided below.

## Instructions

1. Read the comment carefully and understand what change is being requested
2. Read the relevant file(s) and surrounding context
3. Make the requested changes
4. Verify the changes compile/lint if applicable
5. Commit with a message like "address review: <summary of change>"
6. Push the commit

## Important

- Only change what the reviewer asked for -- don't refactor unrelated code
- If the comment is a question (not a change request), reply via:
  ```bash
  gh pr comment {prNumber} --body "response text"
  ```
- If you're unsure what the reviewer means, leave a comment asking for
  clarification rather than guessing
- For top-level PR comments (not inline review comments): use your discretion
  to determine if the comment is actionable. Many PR comments are conversational
  ("LGTM", "looks good", etc.) and don't require code changes. If the comment
  doesn't request a specific change, skip it -- don't make unnecessary
  modifications.

## Concurrency Warning

Another agent may be working in this same worktree concurrently (e.g., fixing
CI while you address a review comment). Before committing:
1. Run `git status` to check for unexpected changes
2. If there are uncommitted changes you didn't make, do a `git stash` before
   your work and `git stash pop` after, or coordinate via sequential commits
3. Pull before pushing to avoid conflicts
```

---

## Phase 4: Fix CI Skill

### File: `plugins/anvil/skills/fix-ci/SKILL.md` (CREATE)

```markdown
---
name: Fix CI Failure
description: Investigates and fixes a CI check failure on a pull request
user-invocable: false
allowed-tools: bash,read,edit,write,grep,glob
---

You are fixing a CI check failure on a pull request. The failing check
details are provided below.

## Instructions

1. Examine the failing check output to understand what went wrong
2. If the failure is in a test:
   - Read the test file and the code it tests
   - Determine if the test needs updating or the code has a bug
   - Fix accordingly
3. If the failure is a lint/build error:
   - Read the error output
   - Fix the source file
4. **Run the failing check locally to verify the fix before pushing.**
   This is critical -- do not push until you have confidence the fix works.
   Run the relevant test suite, linter, or build command locally.
5. Commit with a message like "fix: <what was fixed> (CI)"
6. Only push after local verification passes

## Important

- Focus only on the failing check -- don't fix unrelated issues
- If the failure seems like a flaky test or infrastructure issue, report it
  rather than making code changes
- If you can't determine the cause, report what you found
- **Do not push a fix unless you've verified it locally.** A bad push
  triggers another CI run and potentially another fix attempt, creating
  a feedback loop.

## Concurrency Warning

Another agent may be working in this same worktree concurrently (e.g.,
addressing review comments while you fix CI). Before committing:
1. Run `git status` to check for unexpected changes
2. If there are uncommitted changes you didn't make, do a `git stash` before
   your work and `git stash pop` after, or coordinate via sequential commits
3. Pull before pushing to avoid conflicts
```

---

## Phase 5: Auto-Address Toggle Wiring

The auto-address toggle UI lives in the PR content pane (plan B). This phase wires the toggle to the PR entity service so enabling/disabling auto-address updates the persisted metadata.

### Auto-Address State Model

Auto-address state lives entirely on the PR metadata:
- `autoAddressEnabled: boolean` -- whether agents should be spawned
- `gatewayChannelId: string | null` -- the channel handling events for this PR's repo

The gateway channel is unaware of which PRs are auto-addressed -- it delivers events for all PRs. The PR entity listener checks `pr.autoAddressEnabled` to decide whether to spawn agents.

### File: `core/types/pull-request.ts` (MODIFY -- verify fields exist)

Ensure these fields are on `PullRequestMetadataSchema` (they should be from plan A):

```typescript
/** Whether auto-address is enabled for this PR */
autoAddressEnabled: z.boolean().default(false),
/** Gateway channel ID for this PR's repo (set when auto-address enabled) */
gatewayChannelId: z.string().uuid().nullable().default(null),
```

### Enable Flow

When the user toggles auto-address ON:

```typescript
// In the PR content pane toggle handler (or a service method):
async function enableAutoAddress(prId: string): Promise<void> {
  const pr = pullRequestService.get(prId);
  if (!pr) throw new Error(`PR not found: ${prId}`);

  // Channel always exists (created during repo hydration on mount in D1)
  const channel = gatewayChannelService.getByRepoId(pr.repoId);
  if (!channel) {
    throw new Error("No gateway channel found for this repo. Gateway channels are created on startup.");
  }

  await pullRequestService.update(prId, {
    autoAddressEnabled: true,
    gatewayChannelId: channel.id,
  });
}
```

### Disable Flow

```typescript
async function disableAutoAddress(prId: string): Promise<void> {
  await pullRequestService.update(prId, {
    autoAddressEnabled: false,
    gatewayChannelId: null,
  });
}
```

Note: disabling auto-address does NOT stop running threads. If auto-address agents are currently running, they continue to completion. The toggle only prevents new agents from being spawned.

### Auto-Disable on PR Close/Merge

When a `pull_request.closed` event arrives (handled in the `pull_request` lifecycle listener from plan C), auto-address should be disabled:

```typescript
// In the pull_request event handler (plan C / listeners.ts):
if (githubEventType === "pull_request" && payload.action === "closed") {
  const prNumber = (payload.pull_request as Record<string, unknown>)?.number;
  if (typeof prNumber === "number") {
    const pr = pullRequestService.getByRepoAndNumber(channel.repoId, prNumber);
    if (pr?.autoAddressEnabled) {
      await pullRequestService.update(pr.id, {
        autoAddressEnabled: false,
        gatewayChannelId: null,
      });
      logger.log(`[PrListener] Auto-disabled auto-address for closed PR #${prNumber}`);
    }
  }
}
```

### Auto-Disable on Archive

When a PR entity is archived, auto-address should be disabled. This should be handled in the PR entity's `archive` method (plan A).

### Permission Mode Setting

The permission mode for auto-address agents defaults to `"approve"` (defined in `core/types/permissions.ts` as `PermissionModeId`). This means agents wait for user approval on each tool call.

Valid values are `"plan"`, `"implement"`, or `"approve"` — matching the existing `PermissionModeId` type.

For v1, this is hardcoded to `"approve"`. A future settings UI can expose this as a configurable option under a "Pull Requests" or "Auto-Address" section.

---

## Verification

After implementation, verify:

1. **Event helpers are pure and testable:** Write unit tests for `extractPrNumber` and `classifyGithubEvent` covering all event types, edge cases (empty pull_requests arrays, missing fields, wrong action types).

2. **Debouncing works correctly:** Write a test that fires multiple events in quick succession and verifies only one callback executes after the debounce window.

3. **Skills are synced:** After `syncManagedSkills()` runs, verify `~/.anvil/skills/address-pr-comment/SKILL.md` and `~/.anvil/skills/fix-ci/SKILL.md` exist.

4. **End-to-end event flow (integration test):**
   - Emit a `GITHUB_WEBHOOK_EVENT` with type `pull_request_review_comment`, action `created`, and a valid PR number
   - Verify the listener finds the PR entity, classifies the event, and (if autoAddressEnabled) spawns a thread with the correct prompt starting with `/address-pr-comment`

5. **Toggle wiring:** Enable auto-address on a PR entity, verify `autoAddressEnabled` is true and `gatewayChannelId` is set. Disable, verify both are reset.

See [testing.md](../../docs/testing.md) for test commands and frameworks. Follow the test patterns in `src/entities/threads/__tests__/` and `src/entities/threads/listeners.test.ts`.
