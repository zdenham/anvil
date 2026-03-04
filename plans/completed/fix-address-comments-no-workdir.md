# Fix: Address Comments Button — No Working Directory

## Problem

When clicking the "Address Comments" floating button from the **worktree changes tab**, the button logs:

```
[FloatingAddressButton] No working directory for thread
```

…and does nothing. It should create a new thread and send the comment-addressing prompt to the agent.

## Root Cause

The button components try to derive `workingDirectory` from thread metadata via `useWorkingDirectory(thread)`. But in the changes tab there's no thread — `threadId` is null, so the hook returns `""`. Meanwhile `resolveTarget()` reads `t?.workingDirectory` from `ThreadMetadata`, a field that doesn't exist.

The real issue is that `worktreePath` is **already available** in the changes view (`data.worktreePath` from `useChangesData`) — it just never gets piped to the button. The button shouldn't need to derive the working directory from thread state at all.

## Phases

- [x] Add `repoId` and `worktreePath` to `DiffCommentContext` and pass them through from both mount sites
- [x] Rewrite both button components to use context values directly, with a create-thread fallback when no threadId exists
- [x] Remove `useWorkingDirectory` usage and thread-store lookups for working directory from both buttons

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Detailed Changes

### Phase 1: Add `repoId` + `worktreePath` to DiffCommentContext

**`src/contexts/diff-comment-context.tsx`**:
- Add `repoId: string` and `worktreePath: string` to `DiffCommentState`
- Add matching params to `DiffCommentProvider` and `createDiffCommentStore`

**`src/components/changes/changes-view.tsx`** (line 71):
- Already has `repoId` as a prop and `data.worktreePath` from the hook. Just pass them through:
  ```tsx
  <DiffCommentProvider worktreeId={worktreeId} repoId={repoId} worktreePath={data.worktreePath}>
  ```

**`src/components/content-pane/content-pane.tsx`** (line 144):
- Has `activeMetadata.repoId` and `activeMetadata.worktreeId`. For `worktreePath`, use the synchronous lookup that `useChangesData` already uses:
  ```tsx
  const worktreePath = useRepoWorktreeLookupStore((s) =>
    s.getWorktreePath(activeMetadata?.repoId, activeMetadata?.worktreeId)
  );
  ```
  Then pass it through:
  ```tsx
  <DiffCommentProvider
    worktreeId={activeMetadata.worktreeId}
    repoId={activeMetadata.repoId}
    worktreePath={worktreePath}
    threadId={view.threadId}
  >
  ```

### Phase 2: Simplify both button components

**`src/components/diff-viewer/floating-address-button.tsx`** and **`address-comments-button.tsx`**:

Replace `resolveTarget()` + `useWorkingDirectory` + thread store lookup with direct context reads:

```tsx
const repoId = useDiffCommentStore((s) => s.repoId);
const worktreeId = useDiffCommentStore((s) => s.worktreeId);
const worktreePath = useDiffCommentStore((s) => s.worktreePath);
const threadId = useDiffCommentStore((s) => s.threadId);
```

In `handleClick`, the logic becomes:

```tsx
if (!worktreePath) {
  logger.warn("[FloatingAddressButton] No worktreePath in context");
  return;
}

// ... build prompt from unresolved comments ...

if (threadId) {
  const isConnected = await isAgentSocketConnected(threadId);
  if (isConnected) {
    await sendQueuedMessage(threadId, prompt);
  } else {
    await resumeSimpleAgent(threadId, prompt, worktreePath);
  }
} else {
  // No thread — create one (changes tab case)
  await createThread({ prompt, repoId, worktreeId, worktreePath });
}
```

No thread store queries. No `resolveTarget`. No "find the most recent thread for this worktree" heuristic.

### Phase 3: Cleanup

Remove from both button components:
- `useWorkingDirectory` import and usage
- `useThreadStore` import and the `thread` selector
- The `resolveTarget` callback

## Files Modified

| File | Change |
|------|--------|
| `src/contexts/diff-comment-context.tsx` | Add `repoId` + `worktreePath` to state |
| `src/components/changes/changes-view.tsx` | Pass `repoId` + `worktreePath` to provider |
| `src/components/content-pane/content-pane.tsx` | Pass `repoId` + `worktreePath` to provider |
| `src/components/diff-viewer/floating-address-button.tsx` | Use context directly, add create-thread path |
| `src/components/diff-viewer/address-comments-button.tsx` | Same |
