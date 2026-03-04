# Filter stale comments from "Address Comments" flow

## Problem

When a comment is on a file/line that is no longer in the current diff, it still shows up in:
1. The floating "Address N comments" button count
2. The per-file "Address" button count
3. The prompt sent to the agent when clicking either button

This means the agent gets asked to address comments on code that isn't part of the current changes, which doesn't make sense.

## Root Cause

`getUnresolved` / `getUnresolvedCount` in the comment store (`src/entities/comments/store.ts`) only filters by `worktreeId`, `threadId`, and `resolved` status. There's no cross-reference with the current diff.

The data needed for filtering already exists:
- `useChangesViewStore` has `changedFilePaths: Set<string>` — the set of file paths in the current diff
- Both stores use the same relative-to-repo-root file paths

## Approach

Create a shared hook `useUnresolvedInDiff` that combines data from both stores — filtering unresolved comments to only those whose `filePath` is in `changedFilePaths`. Use it in both address button components.

**Why not auto-resolve?** Too aggressive — a file might temporarily leave the diff (e.g., partial revert) and come back. Filtering from the address flow is safe and reversible.

**Why not line-level filtering?** File-level covers the primary case (file no longer changed at all). Line-level hunk checking is more complex and can be a follow-up if needed.

## Phases

- [x] Create `useUnresolvedInDiff` hook
- [x] Update both address button components to use it
- [x] Verify the file header badge doesn't need changes (it's already file-scoped)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### 1. New hook: `src/hooks/use-unresolved-in-diff.ts`

```ts
import { useCallback, useMemo } from "react";
import { useCommentStore } from "@/entities/comments/store";
import { useChangesViewStore } from "@/stores/changes-view-store";

/**
 * Returns unresolved comments filtered to only files present in the current diff.
 * Falls back to all unresolved if no diff data is available.
 */
export function useUnresolvedInDiff(
  worktreeId: string,
  threadId?: string | null,
) {
  const changedFilePaths = useChangesViewStore((s) => s.changedFilePaths);

  const allUnresolved = useCommentStore(
    useCallback(
      (s) => s.getUnresolved(worktreeId, threadId),
      [worktreeId, threadId],
    ),
  );

  const filtered = useMemo(
    () =>
      changedFilePaths.size > 0
        ? allUnresolved.filter((c) => changedFilePaths.has(c.filePath))
        : allUnresolved,
    [allUnresolved, changedFilePaths],
  );

  return filtered;
}
```

Key decisions:
- Falls back to all unresolved when `changedFilePaths` is empty (avoids hiding everything when diff hasn't loaded yet)
- Returns the filtered array; consumers can derive `.length` for count

### 2. Update `AddressCommentsButton`

Replace the `unresolvedCount` selector + `getUnresolved()` call with `useUnresolvedInDiff`:

```diff
-const unresolvedCount = useCommentStore(
-  useCallback(
-    (s) => s.getUnresolvedCount(worktreeId, threadId),
-    [worktreeId, threadId],
-  ),
-);
+const unresolvedComments = useUnresolvedInDiff(worktreeId, threadId);
+const unresolvedCount = unresolvedComments.length;
```

And in `handleClick`, use the already-filtered list instead of re-fetching from the store:

```diff
-const unresolvedComments = useCommentStore.getState().getUnresolved(worktreeId, threadId);
+// unresolvedComments already filtered by useUnresolvedInDiff
```

### 3. Update `FloatingAddressButton`

Same pattern as `AddressCommentsButton`.

### 4. `FileHeaderCommentBadge` — no change needed

This badge is rendered per-file inside the diff viewer. Files not in the diff won't have a card rendered at all, so their badges won't appear. No filtering needed here.

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/use-unresolved-in-diff.ts` | New hook |
| `src/components/diff-viewer/address-comments-button.tsx` | Use new hook |
| `src/components/diff-viewer/floating-address-button.tsx` | Use new hook |
