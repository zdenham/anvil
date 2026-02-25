# Fix Duplicate Agent Spawn on PR Review Comments

## Problem

When a PR review comment is posted, GitHub fires two webhook events:
1. `pull_request_review` (action: `submitted`) — the review itself (even single comments create a review with state `COMMENTED`)
2. `pull_request_review_comment` (action: `created`) — the individual inline comment

Both events reach the PR listener and get classified into `review-submitted` / `review-comment`. The debounce bucket correctly deduplicates them, so only one agent spawns — but subscribing to redundant webhook events adds unnecessary noise and complexity.

## Research: GitHub Webhook Event Comparison

Comprehensive analysis of when each event fires, based on [official GitHub docs](https://docs.github.com/en/webhooks/webhook-events-and-payloads) and REST API schema for [review comments](https://docs.github.com/en/rest/pulls/comments).

### When each event fires

| User action | `pull_request_review` | `pull_request_review_comment` | `comment.pull_request_review_id` |
|---|---|---|---|
| Submit formal review (Approve/Changes Requested/Comment) with N inline comments | `submitted` × 1 | `created` × N | All N share same ID = `review.id` |
| "Add single comment" on a diff line | `submitted` (implicit review, state: `commented`, empty body) | `created` | Matches `review.id` |
| Reply to existing review thread | `submitted` (new implicit review, state: `commented`, empty body) | `created` (with `in_reply_to_id`) | Matches **new** `review.id` (not the original thread's review) |
| Reply batched into pending review | `submitted` (when submitted) | `created` | Matches batched `review.id` |
| Edit an existing review comment | NO | `edited` | — |
| Delete a review comment | NO | `deleted` | — |
| Edit the review body/summary text | `edited` | NO | — |
| Dismiss a review | `dismissed` | NO | — |
| Pending review comments (before submission) | NO | NO | — |

### Key finding

**Every `pull_request_review_comment` with `action: "created"` also fires a `pull_request_review` with `action: "submitted"`.** This includes reply comments — GitHub wraps them in a new implicit review. The only `pull_request_review_comment` events without a corresponding `pull_request_review` are `edited` and `deleted`, which we already ignore.

The `comment.pull_request_review_id` field (`integer | null`, non-null in practice) always matches `review.id` from the corresponding `pull_request_review` event.

### What's in each payload

| Field | `pull_request_review` | `pull_request_review_comment` |
|---|---|---|
| PR number | `pull_request.number` | `pull_request.number` |
| Review body/summary | `review.body` | NOT included |
| Review state | `review.state` (approved/changes_requested/commented) | NOT included |
| Review ID | `review.id` | `comment.pull_request_review_id` |
| Individual comment body | **NOT included** — must fetch via API | `comment.body` |
| File path + line | NOT included | `comment.path`, `comment.line` |
| Diff context | NOT included | `comment.diff_hunk` |
| Reply-to reference | NOT included | `comment.in_reply_to_id` |

### Conclusion: safe to drop `pull_request_review_comment`

Since we only care about `action: "created"` (not edits/deletes), and every `created` comment also fires `pull_request_review` with `action: "submitted"`, **`pull_request_review` provides complete coverage**. For a batched review with N comments, we get 1 `pull_request_review` event instead of N `pull_request_review_comment` events — which is actually better since we fetch all unresolved comments fresh via `gh` CLI anyway.

| What we keep | What we lose | Impact |
|---|---|---|
| All review submissions (approve, request changes, comment) | Comment edits (`edited`) | Already ignored |
| All single inline comments | Comment deletes (`deleted`) | Already ignored |
| All reply comments (via implicit review) | N per-comment events for batched reviews | Not needed — we fetch fresh context |

## Solution

**Drop `pull_request_review_comment` from webhook subscriptions entirely.** `pull_request_review` fires for every scenario we care about, including reply comments (which create implicit reviews). The agent fetches fresh context via `gh` CLI regardless of which event triggered it.

The debounce is working correctly today, but there's no reason to subscribe to a redundant event. Removing it simplifies the code and eliminates an unnecessary event classification path.

## Phases

- [x] Remove `pull_request_review_comment` from webhook subscriptions and event handling
- [x] Clean up dead code paths for `review-comment` action type
- [x] Update tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Remove webhook subscription

**`src/lib/gh-cli/webhooks.ts`** — Remove `"pull_request_review_comment"` from the `events` array passed to GitHub webhook creation. Existing webhooks will need to be updated manually or on next channel recreation, but new channels will no longer subscribe.

**`src/entities/pull-requests/event-helpers.ts`**:
- Remove the `"pull_request_review_comment"` case from `extractPrNumber()`
- Remove the `"pull_request_review_comment"` case from `classifyGithubEvent()`

**`server/src/gateway/routes/channel-events.ts`** — No changes needed (it forwards all events generically).

## Phase 2: Clean up dead code

**`src/entities/pull-requests/event-helpers.ts`**:
- Remove the `"review-comment"` variant from the `PrAction` type union
- Remove `"review-comment"` entries from `DEBOUNCE_MS`, `DEBOUNCE_BUCKET`
- Remove the `"review-comment"` case from `fetchFreshContext()` (it already shares the same case as `"review-submitted"`)
- Remove the `"review-comment"` case from `buildAutoAddressPrompt()`
- Remove the `"review-comment"` case from `threadName()`
- Remove the `DEBOUNCE_BUCKET` indirection entirely — with `review-comment` gone, each action type maps to its own bucket, so the shared-bucket concept is unnecessary. Just use `action.type` directly as the debounce key in `debounceAutoAddress()` and remove the `DEBOUNCE_BUCKET` record + its comment about deduplicating `pull_request_review` / `pull_request_review_comment`

## Phase 3: Update tests

- Update `event-helpers.test.ts`: remove `pull_request_review_comment` test cases, remove `review-comment` debounce/prompt tests
- Update `listeners-webhook.test.ts`: remove test cases for `pull_request_review_comment` events
- Add a test confirming that `pull_request_review` (submitted, state: `commented`) correctly triggers agent spawn — this is the path that now handles all inline comments
