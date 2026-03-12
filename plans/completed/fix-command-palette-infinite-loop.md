# Fix CommandPalette Infinite Re-render Loop

## Diagnosis

**Error**: `Maximum update depth exceeded` in `<CommandPalette>` — React's 50-nested-update limit hit during the commit phase.

**Root cause**: The diff that added `useActiveWorktreeContext` and the worktree switcher tripled the number of zustand store subscriptions (3 → 8) and embedded `useMRUWorktree` (3 `useState` + async load) inside a hook that runs every render — even when the palette is **closed**. During app initialization, every store hydration (threads, plans, pane layout, terminal sessions, repo worktree lookup) triggers a re-render. Several of these change derived values (`workingDirectory`, `repoId`, `worktreeId`), which fire effects that call `setFileItems([])` — creating a **new empty array reference** each time (`Object.is([], [])` is `false`). The cascading re-renders + state updates + `useSyncExternalStore` tearing checks from unstable selectors exceed the 50-update limit.

**Why the original code didn't crash**: It only had 3 store subscriptions (`_threadsArray`, `_plansArray`, plan stale check from `usePlanContent`) and `useMRUWorktree` was the only context source. The new code adds subscriptions to `paneLayoutStore`, `threadStore` (entity lookup), `planStore` (entity lookup), `terminalSessionStore`, and `repoWorktreeLookupStore` — all of which hydrate during init, all of which fire while the palette is closed and all hooks are running.

### Contributing factors

1. **All hooks run when `isOpen=false`** — The `if (!isOpen) return null` at line 294 is after all hooks. React requires hooks to run unconditionally, so 8 store subscriptions + `useMRUWorktree`'s async load + 5 effects all execute while the palette is invisible.

2. **`useMRUWorktree` does heavy async work inside a render hook** — Calls `worktreeService.sync()` + `loadSettings()` for each repo, then sets 3 state variables. This was designed for one-shot use, not to be embedded inside another hook that adds 4 more subscriptions.

3. **`setFileItems([])` creates unstable references** — Effect at line 170 calls `setFileItems([])` whenever `workingDirectory`/`repoId`/`worktreeId` change with an empty query. Each call creates a new empty array that React sees as a state change.

4. **Bounds check triggers no-op setState** — When `filteredItems.length === 0`, the condition `0 >= 0` passes and calls `setSelectedIndex(0)` which is already 0. React does a verification render even for same-value setState.

5. **`planService.getPlanContent()` writes back to the plan store** — `markAsValid` updates `lastVerified` on the plan, creating a new `_plansArray` reference, which triggers `items` recalculation even though sort order doesn't change.

## Phases

- [ ] Split `CommandPalette` into wrapper + inner component so hooks only run when open
- [ ] Replace `useMRUWorktree` in `useActiveWorktreeContext` with lightweight lookup-store derivation
- [ ] Stabilize `setFileItems` with a module-level empty array constant
- [ ] Fix bounds-check effect to avoid no-op setState

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

### Phase 1: Split into wrapper + inner

`command-palette.tsx`:

```tsx
// Wrapper — no hooks, just a gate
export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  if (!isOpen) return null;
  return <CommandPaletteInner onClose={onClose} />;
}

// Inner — all hooks, only mounts when palette is visible
function CommandPaletteInner({ onClose }: { onClose: () => void }) {
  // ... all existing hooks/effects/JSX ...
  // Remove the isOpen guards from effects (component only exists when open)
}
```

This eliminates the initialization cascade entirely — by the time the user opens the palette, all stores are hydrated and stable.

The reset-on-open effect (line 145) becomes a mount effect:
```tsx
useEffect(() => {
  setQuery("");
  setSelectedIndex(0);
  setMouseMovedSinceOpen(false);
  setFileItems(EMPTY_ITEMS);
  setWorktreeOverrideId(null);
  setTimeout(() => inputRef.current?.focus(), 0);
  if (workingDirectory) {
    getFileSearchService().load(workingDirectory);
  }
}, []); // mount-only — palette just opened
```

Remove `isOpen` from the dependency array since the component only exists when open. Keep `workingDirectory` changes handled by a separate lighter effect if needed (just reload file search cache, don't reset all state).

### Phase 2: Replace `useMRUWorktree` in `useActiveWorktreeContext`

The `useMRUWorktree` hook syncs worktrees from disk on every mount — expensive and unnecessary since `useRepoWorktreeLookupStore` is already hydrated with the same data.

Replace the MRU fallback in `useActiveWorktreeContext` with a lightweight derivation:

```tsx
export function useActiveWorktreeContext(): ActiveWorktreeContext {
  // Use already-hydrated lookup store for MRU fallback
  const firstWorktree = useRepoWorktreeLookupStore((s) => {
    // Return first worktree found (stable reference from store)
    for (const [repoId, repo] of s.repos) {
      for (const [worktreeId, wt] of repo.worktrees) {
        if (wt.path) return { workingDirectory: wt.path, repoId, worktreeId };
      }
    }
    return null;
  });

  // ... existing activeView / thread / plan / terminal selectors ...

  // Fall back to first available worktree instead of MRU
  return firstWorktree ?? { workingDirectory: null, repoId: null, worktreeId: null };
}
```

**Important**: This selector also creates a new object — use a stable sentinel or `useRef`-based memoization:
```tsx
const fallbackRef = useRef<ActiveWorktreeContext | null>(null);
// Update ref only when values actually change (compare primitives)
```

Or simpler: select the primitives individually:
```tsx
const fallbackPath = useRepoWorktreeLookupStore((s) => {
  for (const [, repo] of s.repos) {
    for (const [, wt] of repo.worktrees) {
      if (wt.path) return wt.path;
    }
  }
  return null;
});
// Similar for fallbackRepoId, fallbackWorktreeId
```

Remove the `import { useMRUWorktree }` entirely from this hook.

### Phase 3: Stable empty array for `setFileItems`

```tsx
// Module-level constant — same reference every time
const EMPTY_ITEMS: PreviewableItem[] = [];
```

Use it in:
- `useState<PreviewableItem[]>(EMPTY_ITEMS)` (initial state)
- `setFileItems(EMPTY_ITEMS)` in the file search effect (line 173)
- `setFileItems(EMPTY_ITEMS)` in the reset effect
- `setFileItems(EMPTY_ITEMS)` in `cycleWorktree`

### Phase 4: Fix bounds-check effect

Current (line 202):
```tsx
useEffect(() => {
  if (selectedIndex >= filteredItems.length) {
    setSelectedIndex(Math.max(0, filteredItems.length - 1));
  }
}, [filteredItems.length, selectedIndex]);
```

Fix — only call setState when the value would actually change:
```tsx
useEffect(() => {
  if (filteredItems.length > 0 && selectedIndex >= filteredItems.length) {
    setSelectedIndex(filteredItems.length - 1);
  }
}, [filteredItems.length, selectedIndex]);
```

When `filteredItems.length === 0`, there's nothing to select — leave `selectedIndex` as-is (the UI already handles the empty case with "No results found").
