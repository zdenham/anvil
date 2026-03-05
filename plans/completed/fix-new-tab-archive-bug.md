# Fix: New Tab Threads Cannot Be Archived

## Problem

Clicking "new tab" in the tab bar creates a thread via `createOptimistic()` only — the thread exists in memory (Zustand store) but is **never written to disk**. When the user tries to archive this thread, `findThreadPath()` returns `undefined` and the archive operation skips it with a warning, leaving a zombie thread in the sidebar.

## Root Cause

`tab-bar.tsx:44` calls `threadService.createOptimistic()` which only updates the in-memory store. Compare to the normal flow in `thread-creation-service.ts` which calls `createOptimistic()` first for instant UI, then spawns an agent that persists via `threadService.create()`.

New tab threads have no prompt and no agent — they're just empty placeholders. Since no agent runs, nothing ever calls `threadService.create()` to persist them.

## Phases

- [x] Fix new tab to persist thread to disk
- [x] Harden archive to handle memory-only threads gracefully

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix new tab to persist thread to disk

**File**: `src/components/split-layout/tab-bar.tsx`

Change `handleNewTab` to call `threadService.create()` instead of `threadService.createOptimistic()`. Since `create()` is async and writes `metadata.json` to disk, the thread will be archivable immediately.

The `create()` method requires a `prompt` field (it's part of the turns array). For an empty new tab, we have two options:

**Option A (recommended)**: Use `threadService.create()` but make `prompt` optional in `CreateThreadInput` so empty-turn threads can be persisted. The schema already supports `turns: []` via `createOptimistic`, so the metadata shape is valid — we just need `create()` to handle the no-prompt case.

**Option B**: Keep `createOptimistic()` for the instant UI update but immediately follow it with a disk write (call `appData.ensureDir` + `appData.writeJson` directly). This avoids changing the `create()` API but duplicates persistence logic.

**Recommendation**: Option A — modify `threadService.create()` to accept an optional prompt, producing `turns: []` when omitted. Then `handleNewTab` becomes:

```ts
const handleNewTab = useCallback(async () => {
  if (!repoId || !worktreeId) {
    logger.warn("[TabBar] No MRU worktree available, opening empty tab");
    paneLayoutService.openTab({ type: "empty" }, groupId);
    return;
  }

  const threadId = crypto.randomUUID();
  // create() persists to disk AND updates the store
  await threadService.create({
    id: threadId,
    repoId,
    worktreeId,
  });
  paneLayoutService.openTab(
    { type: "thread", threadId, autoFocus: true },
    groupId,
  );
}, [groupId, repoId, worktreeId]);
```

Need to check: `CreateThreadInput` type requires `prompt: string`. Make it optional:

```ts
// In service.ts or types
interface CreateThreadInput {
  id?: string;
  repoId: string;
  worktreeId: string;
  prompt?: string;  // ← make optional
  git?: ...;
  permissionMode?: ...;
}
```

And in `create()`, conditionally build turns:

```ts
turns: input.prompt
  ? [{ index: 0, prompt: input.prompt, startedAt: now, completedAt: null }]
  : [],
```

This matches the existing `createOptimistic()` behavior exactly.

## Phase 2: Harden archive for memory-only threads

**File**: `src/entities/threads/service.ts`, `archive()` method

Even with Phase 1, there may be edge cases (race conditions, app crashes before disk write) where a thread exists in memory but not on disk. The archive method should handle this gracefully:

When a thread is not found on disk, **delete it from the store** instead of silently skipping:

```ts
const sourcePath = await findThreadPath(id);
if (!sourcePath) {
  logger.warn(`[threadService.archive] Thread ${id} not found on disk, removing from store`);
  useThreadStore.getState()._applyDelete(id);
  continue;
}
```

This ensures the zombie thread is cleaned up from the UI. The current code just `continue`s, leaving the thread stuck in the sidebar forever.

## Files to Change

1. **`src/components/split-layout/tab-bar.tsx`** — Switch from `createOptimistic` to `create`
2. **`src/entities/threads/service.ts`** — Make `prompt` optional in `create()`, handle empty turns; harden `archive()` for disk-missing threads
3. **Types file** (if `CreateThreadInput` is defined separately) — Make `prompt` optional
