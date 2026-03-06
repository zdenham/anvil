# Fix: Clicking commit in sidebar doesn't update tab content

## Problem

Clicking a commit in the left side panel doesn't replace the current tab with the new commit's changes. The tab stays showing whatever it was previously showing (e.g., uncommitted changes or a different commit).

## Root Cause

In `src/stores/pane-layout/service.ts:244`, the `viewsMatch()` function treats all "changes" views for the same repo/worktree as identical, ignoring `commitHash` and `uncommittedOnly`:

```typescript
case "changes": return b.type === "changes" && a.repoId === b.repoId && a.worktreeId === b.worktreeId;
```

This means when `findOrOpenTab()` (line 204) searches for a matching tab, it finds the existing changes tab and just activates it (line 217) — without updating the tab's view to the new commit. The replacement path (`setActiveTabView`, line 227) is never reached because the match is found too eagerly.

## Fix

Update `viewsMatch()` to also compare `commitHash` and `uncommittedOnly` for "changes" views:

```typescript
case "changes":
  return b.type === "changes" &&
    a.repoId === b.repoId &&
    a.worktreeId === b.worktreeId &&
    a.commitHash === b.commitHash &&
    a.uncommittedOnly === b.uncommittedOnly;
```

With this fix:
- Clicking a commit when an uncommitted changes tab is open → **no match** → replaces tab via `setActiveTabView`
- Clicking a different commit → **no match** → replaces tab
- Clicking the same commit that's already showing → **match** → just activates it (no-op)

## Phases

- [x] Update `viewsMatch()` in `src/stores/pane-layout/service.ts` to include `commitHash` and `uncommittedOnly`
- [x] Update or add a test case in `src/stores/pane-layout/__tests__/service.test.ts` to verify distinct commit hashes don't match

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files

| File | Change |
|------|--------|
| `src/stores/pane-layout/service.ts:244` | Add `commitHash` and `uncommittedOnly` to the "changes" case in `viewsMatch()` |
| `src/stores/pane-layout/__tests__/service.test.ts` | Add test for commit-specific matching |
