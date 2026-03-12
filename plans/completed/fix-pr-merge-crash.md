# Fix: PR Merge Button Crashes UI

## Root Cause

**Two bugs, both triggered by clicking Merge:**

### Bug 1: React Rules of Hooks Violation (the crash)

`src/components/content-pane/pr-merge-section.tsx:36-48` has a conditional early return **before** `useEffect` hooks:

```tsx
// Hooks 1-5 (useState, useCallback, usePullRequestStore)
const mergeSettings = usePullRequestStore(useCallback(...));
const [method, setMethod] = useState(null);
const [isMerging, setIsMerging] = useState(false);
const [error, setError] = useState(null);

if (state !== "OPEN" || isDraft) return null;  // ← EARLY RETURN

useEffect(() => { ... }, [prId]);              // ← Hook 6: CONDITIONAL
useEffect(() => { ... }, [mergeSettings]);     // ← Hook 7: CONDITIONAL
```

**Flow:**

1. Component renders with `state: "OPEN"` → 7 hooks called
2. Merge succeeds → `fetchPrDetails` updates store → `state: "MERGED"`
3. Component re-renders → only 5 hooks called (early return before useEffects)
4. React throws: "Rendered fewer hooks than expected"
5. GlobalErrorBoundary catches it → UI appears dead

### Bug 2: `--delete-branch` is dangerous in worktree context

`src/lib/gh-cli/pr-queries.ts:254-256` runs:

```
gh pr merge <num> --squash --delete-branch
```

In a worktree setup, `--delete-branch` causes `gh` to attempt `git checkout main` which fails with `fatal: 'main' is already checked out at '...'` because the base branch is checked out in another worktree. This is the "git fatal message" the user sees briefly before the hooks crash takes down the UI.

Even when `gh` exits non-zero, the merge has already succeeded on GitHub. So the error from `--delete-branch` is a red herring — the real crash comes from the hooks violation when the PR state updates to MERGED.

## Phases

- [x] Fix hooks violation in `PrMergeSection` — move `useEffect` calls above the conditional return

- [x] Remove `--delete-branch` from `mergePr` — handle branch cleanup separately/safely for worktrees

- [x] Add post-merge refresh — after successful merge, refresh PR details and show merged state gracefully

- [x] Update merge test expectations to not include `--delete-branch`

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Implementation Details

### Phase 1: Fix hooks violation

In `src/components/content-pane/pr-merge-section.tsx`:

- Move both `useEffect` calls above the `if (state !== "OPEN" || isDraft) return null` guard
- The effects are safe to run even when not rendering (fetching merge settings for a merged PR is a no-op, and setting default method when component returns null is harmless)

```tsx
// All hooks FIRST
const mergeSettings = usePullRequestStore(useCallback(...));
const [method, setMethod] = useState(null);
const [isMerging, setIsMerging] = useState(false);
const [error, setError] = useState(null);

useEffect(() => { pullRequestService.fetchMergeSettings(prId); }, [prId]);
useEffect(() => { if (mergeSettings && !method) setMethod(mergeSettings.defaultMethod); }, [mergeSettings, method]);

// THEN the early return
if (state !== "OPEN" || isDraft) return null;
```

### Phase 2: Remove `--delete-branch`

In `src/lib/gh-cli/pr-queries.ts:249-258`:

- Remove `"--delete-branch"` from the `mergePr` args
- Branch cleanup for worktrees should be a separate, worktree-aware operation (future work — not needed for this fix since merged worktrees can be archived/deleted via existing UI)

### Phase 3: Post-merge refresh

In `src/entities/pull-requests/pr-details.ts:161-173`, the `mergePr` function already calls `fetchPrDetails(pr)` after the merge. With `--delete-branch` removed, `gh pr merge` should exit 0 cleanly, and `fetchPrDetails` will succeed, returning the MERGED state which updates the store and hides the merge button (via the fixed conditional return).

No additional work needed here — just verify the flow works after phases 1-2.

### Phase 4: Update tests

In `src/lib/gh-cli/__tests__/merge.test.ts`:

- Update the three test assertions to not expect `"--delete-branch"` in the args