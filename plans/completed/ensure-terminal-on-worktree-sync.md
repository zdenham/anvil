# Ensure Terminal Exists on Worktree Sync

## Problem

When a worktree is discovered via `WORKTREE_SYNCED` (agent detects `git worktree add`), it appears in the sidebar without a terminal. The invariant "every worktree has at least one terminal" is only enforced at app startup — not when worktrees are created at runtime.

## Root Cause

Three paths create/discover worktrees:

| Path | Terminal created? | Location |
|---|---|---|
| App startup hydration | Yes — `ensureTerminalsForWorktrees()` | `src/entities/index.ts:187-198` |
| User creates via UI | Yes — `terminalSessionService.create()` | `main-window-layout.tsx:490-497` |
| Agent `WORKTREE_SYNCED` event | **No** | `src/entities/worktrees/listeners.ts:25-39` |

The `WORKTREE_SYNCED` listener syncs worktrees and re-hydrates the lookup store, but never calls `ensureTerminalsForWorktrees()`.

## Phases

- [x] Add `ensureTerminalsForWorktrees` call to `WORKTREE_SYNCED` listener
- [x] Add test coverage for the new behavior
- [x] Verify no other worktree-discovery paths are missing

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `ensureTerminalsForWorktrees` to WORKTREE_SYNCED listener

In `src/entities/worktrees/listeners.ts`, after the `hydrate()` call in the `WORKTREE_SYNCED` handler, call `ensureTerminalsForWorktrees` with the freshly-hydrated worktree list.

```ts
// src/entities/worktrees/listeners.ts — WORKTREE_SYNCED handler
import { terminalSessionService } from "@/entities/terminal-sessions/service.js";

eventBus.on(EventName.WORKTREE_SYNCED, async ({ repoId }) => {
  // ... existing sync + hydrate logic ...

  await worktreeService.sync(repoName, false);
  await useRepoWorktreeLookupStore.getState().hydrate();

  // NEW: ensure every worktree in this repo has at least one terminal
  const repo = useRepoWorktreeLookupStore.getState().repos.get(repoId);
  if (repo) {
    const worktrees: Array<{ worktreeId: string; worktreePath: string }> = [];
    for (const [wtId, wtInfo] of repo.worktrees) {
      if (wtInfo.path) {
        worktrees.push({ worktreeId: wtId, worktreePath: wtInfo.path });
      }
    }
    await terminalSessionService.ensureTerminalsForWorktrees(worktrees);
  }
});
```

This reuses the existing `ensureTerminalsForWorktrees` method which already creates lazy placeholders (no PTY spawned) and is idempotent — it skips worktrees that already have terminals.

### Files to modify

- `src/entities/worktrees/listeners.ts`

## Phase 2: Add test coverage

Add a test in `src/entities/worktrees/__tests__/listeners.test.ts` that verifies: when `WORKTREE_SYNCED` fires, `ensureTerminalsForWorktrees` is called with the correct worktree list from the freshly-hydrated lookup store.

Mock `terminalSessionService.ensureTerminalsForWorktrees` and verify it receives the expected `[{ worktreeId, worktreePath }]` array after the sync+hydrate completes.

### Files to modify

- `src/entities/worktrees/__tests__/listeners.test.ts`

## Phase 3: Verify no other paths are missing

Audit these additional worktree-discovery paths to confirm terminals are covered:

1. **`WORKTREE_NAME_GENERATED`** — rename-only event, worktree already exists, terminal should already be present. No action needed.
2. **`WORKTREE_ALLOCATED` / `WORKTREE_RELEASED`** — these are thread-level orchestration events, not worktree creation. No action needed.
3. **Optimistic worktree insert** (`addOptimisticWorktree` in `main-window-layout.tsx`) — placeholder with no path, terminal is created after the real worktree materializes. Already handled.

No additional changes expected, but verify during implementation.
