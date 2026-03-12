# Fix Right Panel Load Jank

## Problem

Right panel tabs (Changelog, Files, Search) flash loading states every time you switch between them, and Changelog shows "No commits" for a frame on first load.

## Root Causes

### 1. Tabs unmount/remount on every switch

`RightPanelContainer` uses conditional rendering (`{activeTab === "changelog" && <ChangelogPanel/>}`), so switching away from a tab destroys all its state, and switching back triggers a full refetch from scratch.

### 2. Changelog `useGitCommits` initializes `loading: false`

`src/hooks/use-git-commits.ts` line 32: `useState(false)` means there's one render frame with `loading=false, commits=[]` before `useEffect` triggers the fetch — showing "No commits" text.

Note: There's an unused `commit-store.ts` Zustand store with per-worktree commit caching, but nothing populates it. `ChangelogPanel` uses `useGitCommits` which always fetches fresh.

### 3. ChangesView lazy import

`content-pane.tsx` uses `React.lazy(() => import("../changes/changes-view"))` adding a Suspense "Loading..." flash before the component's own loading spinner renders. Double loading state.

## Proposed Fixes

### Fix 1: Keep all right panel tabs mounted (biggest win)

**File**: `src/components/right-panel/right-panel-container.tsx`

Instead of conditional rendering that unmounts inactive tabs, render all three tabs and hide inactive ones with CSS (`display: none` or `hidden` class). This keeps state alive across tab switches — no refetch, no flash, instant tab switching.

```tsx
// Before: unmount/remount on every switch
{activeTab === "changelog" && <ChangelogPanel ... />}

// After: always mounted, hide inactive
<div className={activeTab !== "changelog" ? "hidden" : "flex-1 min-h-0 flex flex-col"}>
  <ChangelogPanel ... />
</div>
```

This is the single biggest improvement — it makes all tab switching instant after first load for Changelog, Files, AND Search. The file tree retains its expanded state, search retains its results, changelog retains its commit list.

Considerations:
- Search panel: may need to not auto-focus input when hidden. Check that keyboard shortcuts don't fire into hidden tabs.
- File browser: file watcher listeners stay alive (this is fine — they're lightweight and keep data fresh).
- FileBrowserPanel has a `key={finalWorktreeId}` — when worktree changes it'll still remount correctly.
- The "files" tab has a conditional check for `finalRepoId && finalWorktreeId && finalRootPath` before rendering `FileBrowserPanel`. This guard still works since the outer div always renders but the inner content is conditional.

### Fix 2: Use commit store for warm-start changelog

**File**: `src/components/right-panel/changelog-panel.tsx`, `src/hooks/use-git-commits.ts`

Two changes:
1. Fix `useState(false)` → `useState(!!branchName && !!workingDirectory)` in `useGitCommits` so loading skeleton shows immediately instead of "No commits".
2. Populate `commit-store.ts` when `useGitCommits` fetches — and on mount, read from the store first as stale-while-revalidate. This way, second load of changelog tab (even if it did unmount) has cached data to show instantly while refetching in background.

Actually, with Fix 1 keeping tabs mounted, this becomes a belt-and-suspenders improvement for the very first load only. Still worth doing since it's a one-line initial loading state fix.

Simpler version: just fix `useState(false)` → `useState(true)` with the guard. Skip the store integration — Fix 1 handles subsequent loads.

```ts
const [loading, setLoading] = useState(!!branchName && !!workingDirectory);
```

### Fix 3: Remove ChangesView lazy loading

**File**: `src/components/content-pane/content-pane.tsx`

Replace `React.lazy` with a regular import. `useChangesData` already has stale-while-revalidate caching for range diffs, so the component itself loads fast on re-entry. The lazy import just adds an unnecessary Suspense flash.

```diff
- const ChangesView = lazy(() => import("../changes/changes-view"));
+ import ChangesView from "../changes/changes-view";
```

Remove the `<Suspense>` wrapper and clean up unused `lazy`/`Suspense` imports.

## Phases

- [ ] Keep all right panel tabs mounted (CSS hidden instead of conditional unmount)
- [ ] Fix useGitCommits initial loading state (`useState(false)` → `useState(true)` with guard)
- [ ] Remove ChangesView lazy loading and Suspense wrapper
- [ ] Verify no regressions (keyboard shortcuts, auto-focus, file watchers, tab switching)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Modify

| File | Change |
| --- | --- |
| `src/components/right-panel/right-panel-container.tsx` | Render all tabs, hide inactive with CSS `hidden` class |
| `src/hooks/use-git-commits.ts` | `useState(false)` → `useState(!!branchName && !!workingDirectory)` |
| `src/components/content-pane/content-pane.tsx` | Remove `lazy`, `Suspense` for ChangesView |
