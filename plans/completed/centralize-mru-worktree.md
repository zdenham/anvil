# Centralize MRU Worktree Logic

## Problem

MRU (Most Recently Used) worktree selection is scattered across 4 implementations:

1. `src/hooks/use-mru-worktree.ts` — React hook using `useState`/`useEffect`, fetches all repos from Rust backend, sorts by `lastAccessedAt`. Each consumer independently loads from disk.
2. `src/components/spotlight/spotlight.tsx:754-795` — Copy-paste duplicate of the same fetch+sort logic.
3. `src/components/main-window/main-window-layout.tsx:240-253` — Command+N fallback takes `worktrees[0]` from `useTreeData()`, which sorts by `sortKey`/`createdAt` — **not MRU at all**.
4. `src/hooks/use-active-worktree-context.ts` — Derives from active tab, falls back to `useMRUWorktree`. Legitimate layering, but depends on the broken hook.

### Why this is broken

- `useMRUWorktree` uses `useState` — every consumer independently fetches and holds a stale copy
- `worktreeService.touch()` updates the Rust backend's `lastAccessedAt`, but no frontend store reflects it reactively
- Command+N picks the wrong worktree (tree sort order, not MRU)
- Spotlight duplicates \~40 lines of logic unnecessarily

## Solution

Create a dedicated `useMRUWorktreeStore` (new zustand store at `src/stores/mru-worktree-store.ts`). The existing `useRepoWorktreeLookupStore` is a read-only hydration cache — adding mutable MRU timestamps that change on every tab switch would mix concerns.

The new store is small (\~60 lines), owns only MRU state, and references the lookup store for resolving IDs → paths/names.

### Design

**New file:** `src/stores/mru-worktree-store.ts`

```ts
interface MRUWorktreeState {
  /** worktreeId → lastAccessedAt timestamp (ms) */
  mruTimestamps: Map<string, number>;

  /** Sorted worktreeIds by MRU (most recent first), recomputed on touch */
  mruOrder: string[];

  /** Hydrate from lookup store's worktree settings (reads lastAccessedAt) */
  hydrate: () => void;

  /** Update timestamp, recompute order, fire-and-forget to Rust */
  touchMRU: (worktreeId: string) => void;

  /** Get the most recently used worktree's {repoId, worktreeId}, or null */
  getMRUWorktree: () => { repoId: string; worktreeId: string } | null;

  /** Get all worktrees sorted by MRU */
  getMRUWorktrees: () => Array<{ repoId: string; worktreeId: string }>;
}
```

**Hydration:** Called after `useRepoWorktreeLookupStore.hydrate()` completes. Reads `lastAccessedAt` from each worktree's settings to bootstrap timestamps. Compute initial `mruOrder`.

**Persistence:** `touchMRU()` does three things synchronously + one async:

1. Updates in-memory `mruTimestamps`
2. Recomputes `mruOrder`
3. Calls `set()` for reactive updates
4. Fire-and-forget `worktreeService.touch()` to Rust backend

**Lookup store stays untouched** — no new state, no new methods.

## Phases

- [x] Create `src/stores/mru-worktree-store.ts` with MRU state, `hydrate()`, `touchMRU()`, and getters

- [x] Wire hydration: call `useMRUWorktreeStore.hydrate()` after lookup store hydration completes

- [x] Rewrite `useMRUWorktree` hook as thin selector over `useMRUWorktreeStore`

- [x] Migrate Spotlight to use the new hook instead of duplicated fetch+sort logic

- [x] Fix Command+N to use `useMRUWorktreeStore.getState().getMRUWorktree()` instead of tree sort order

- [x] Update `useActiveWorktreeContext` to use new hook (should be minimal change)

- [x] Wire `touchMRU()` into the two existing touch sites (tab switch listener + thread creation)

- [x] Remove dead code from old `useMRUWorktree` hook

- [x] Verify Search Panel and Command Palette behavior (may intentionally not use MRU — no changes expected)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Detailed Changes

### 1. Create `src/stores/mru-worktree-store.ts`

Small dedicated zustand store (\~60 lines):

```ts
export const useMRUWorktreeStore = create<MRUWorktreeState>((set, get) => ({
  mruTimestamps: new Map(),
  mruOrder: [],

  hydrate: () => {
    const lookupStore = useRepoWorktreeLookupStore.getState();
    const timestamps = new Map<string, number>();

    for (const [repoId, repo] of lookupStore.repos) {
      for (const [wtId, wt] of repo.worktrees) {
        // lastAccessedAt must be available in settings — check schema
        if (wt.lastAccessedAt) {
          timestamps.set(wtId, wt.lastAccessedAt);
        }
      }
    }

    const mruOrder = [...timestamps.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    set({ mruTimestamps: timestamps, mruOrder });
  },

  touchMRU: (worktreeId: string) => {
    const now = Date.now();
    const timestamps = new Map(get().mruTimestamps);
    timestamps.set(worktreeId, now);

    const mruOrder = [...timestamps.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    set({ mruTimestamps: timestamps, mruOrder });

    // Fire-and-forget to Rust backend
    const lookupStore = useRepoWorktreeLookupStore.getState();
    const repoId = lookupStore.getRepoIdByWorktreeId(worktreeId);
    if (repoId) {
      const path = lookupStore.getWorktreePath(repoId, worktreeId);
      const repoName = lookupStore.getRepoName(repoId);
      worktreeService.touch(repoName, path).catch(() => {});
    }
  },

  getMRUWorktree: () => { /* resolve first mruOrder entry via lookup store */ },
  getMRUWorktrees: () => { /* resolve all mruOrder entries via lookup store */ },
}));
```

**Key design decisions:**

- References `useRepoWorktreeLookupStore.getState()` for ID resolution — no duplicated metadata
- `hydrate()` is a separate call, not auto-triggered — called after lookup store hydrates
- `lastAccessedAt` needs to be added to `WorktreeLookupInfo` during lookup store hydration (read from settings, pass through)

### 2. Rewrite `useMRUWorktree` hook (`src/hooks/use-mru-worktree.ts`)

Replace the 150-line implementation with a thin zustand selector:

```ts
export function useMRUWorktree(): MRUWorktreeResult {
  const mruWorktree = useMRUWorktreeStore((s) => s.getMRUWorktree());
  const mruWorktrees = useMRUWorktreeStore((s) => s.getMRUWorktrees());
  // ... derive workingDirectory, repoId, worktreeId from mruWorktree
}
```

Keep the same `MRUWorktreeResult` interface for backward compatibility. The `refresh` method becomes a no-op or triggers a re-read from the store. `isLoading` derives from `_hydrated`.

### 3. Fix Spotlight (`src/components/spotlight/spotlight.tsx`)

Remove `loadWorktrees` (lines 754-795) and its `useEffect`. Replace with:

```ts
const { repoWorktrees } = useMRUWorktree();
// or directly: useRepoWorktreeLookupStore(s => s.getMRUWorktrees())
```

The spotlight already tracks `selectedWorktreeIndex` for cycling — that stays, but the source list comes from the store.

### 4. Fix Command+N (`src/components/main-window/main-window-layout.tsx`)

Replace lines 240-253 (the fallback that takes `worktrees[0]` from tree data):

```ts
// Before (wrong — uses tree sort order, not MRU):
const worktrees = allItems.filter(i => i.type === "worktree");
const mostRecent = worktrees[0];

// After (correct — uses MRU store):
const mru = useMRUWorktreeStore.getState().getMRUWorktree();
if (mru) {
  repoId = mru.repoId;
  worktreeId = mru.worktreeId;
}
```

### 5. Update touch callsites

`src/stores/pane-layout/listeners.ts:183-203` — Replace:

```ts
worktreeService.touch(resolved.repoName, resolved.worktreePath)
```

with:

```ts
useMRUWorktreeStore.getState().touchMRU(resolved.worktreeId)
```

`src/lib/thread-creation-service.ts:114-141` — Replace the entire PHASE 2 block (which does a manual repo lookup loop to call `worktreeService.touch()`) with:

```ts
useRepoWorktreeLookupStore.getState().touchMRU(worktreeId);
```

This eliminates \~25 lines of boilerplate.

### 6. Verify non-MRU consumers

- **Search Panel** (`src/components/search-panel/`): Uses active thread's worktree, falls back to first option in lookup store order. This is intentional (search context = what you're looking at), not MRU. **No change needed.**
- **Command Palette**: Uses `useActiveWorktreeContext` → active tab → MRU fallback. Correct layering. **No change needed** beyond the hook rewrite propagating automatically.
- **PR detection**: Uses branch matching. **No change needed.**

## Files Changed

| File | Change |
| --- | --- |
| `src/stores/mru-worktree-store.ts` | **New** — dedicated MRU zustand store |
| `src/stores/repo-worktree-lookup-store.ts` | Add `lastAccessedAt` to `WorktreeLookupInfo` during hydration (read-through from settings) |
| `src/hooks/use-mru-worktree.ts` | Rewrite to thin selector over `useMRUWorktreeStore` |
| `src/hooks/use-active-worktree-context.ts` | Minimal (auto-benefits from hook rewrite) |
| `src/components/spotlight/spotlight.tsx` | Remove duplicate MRU logic |
| `src/components/main-window/main-window-layout.tsx` | Fix Command+N to use MRU store |
| `src/stores/pane-layout/listeners.ts` | Use `touchMRU()` instead of direct service call |
| `src/lib/thread-creation-service.ts` | Use `touchMRU()` instead of manual loop |
| Hydration callsite (likely `src/app.tsx` or equivalent) | Chain `useMRUWorktreeStore.hydrate()` after lookup store hydration |

## Notes

- The `RepoWorktree` type used by Spotlight may need the store to expose a richer return type that includes `repoName` and worktree metadata (not just IDs). Check Spotlight's usage of `repoWorktrees[idx].worktree.name`, `.path`, etc.
- `lastAccessedAt` needs to be passed through in `WorktreeLookupInfo` during lookup store hydration. Check that `RepositorySettingsSchema` → `worktrees[]` includes `lastAccessedAt` — the field exists on the Rust side in `WorktreeState`.
- The lookup store itself stays read-only — `lastAccessedAt` is only added as a read-through field for MRU store to bootstrap from. The lookup store never mutates it.