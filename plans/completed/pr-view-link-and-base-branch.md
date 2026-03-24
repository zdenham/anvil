# PR View: Add PR Link + Display Base Branch as `origin/main`

## Problem

Two issues with the PR view:

### 1. No clickable PR link in the PR body
- The header has an "Open in browser" button (`pull-request-header.tsx:67-71`) — but the user wants a visible link in the PR content area itself
- `PullRequestDetails.url` is available (fetched from `gh pr view`) but not rendered in `PrInfoSection`

### 2. Base branch shows `main` instead of `origin/main`
- `pr-actions.ts:130` strips the `origin/` prefix: `.replace("origin/", "")`
- Webhook path (`pr-lifecycle-handler.ts:56`) gets bare `ref` from GitHub API (just `"main"`)
- The ivory-dragonfly worktree's PR metadata confirms: `baseBranch: "main"` in `/Users/zac/.anvil/pull-requests/5b13d519-.../metadata.json`
- User wants it displayed as `origin/main`

## Phases

- [x] Add clickable PR link to PrInfoSection
- [x] Display base branch as `origin/{branch}` in the PR view

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add clickable PR link to PrInfoSection

**File:** `src/components/content-pane/pr-info-section.tsx`

Add the PR URL as a clickable link near the PR number. Use `openUrl` from `@tauri-apps/plugin-opener` (same as the header button does).

Changes:
- Add `url` prop to `PrInfoSectionProps` (sourced from `details.url`)
- Make the `#{prNumber}` text clickable, opening the GitHub PR URL
- Style it as a subtle link (text-surface-500 with hover underline)

**File:** `src/components/content-pane/pull-request-content.tsx`

- Pass `details.url` to `PrInfoSection` as the new `url` prop

## Phase 2: Display base branch as `origin/{branch}`

This is a **display-only** change — we don't change what's persisted in metadata. The metadata stores the bare branch name (which is correct), but the UI should prefix it with `origin/` for clarity.

**File:** `src/components/content-pane/pr-info-section.tsx`

- Display `baseBranch` with `origin/` prefix: change `{baseBranch}` → `{`origin/${baseBranch}`}` in the branch info display (line 89)

This is the simplest approach: the metadata stays clean (`"main"`), and we add the prefix at the display layer only.
