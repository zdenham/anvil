# Remove Content Pane Header, Add Tab Tooltip + Pause Icon

## Problem
The thread header (breadcrumb bar below tabs) takes up too much vertical space. The path info it shows (repo > worktree > threads > name) should move to a tab hover tooltip instead. A pause icon is also needed in the tab.

## Phases

- [x] Comment out ContentPaneHeader rendering in `content-pane.tsx`
- [x] Add breadcrumb tooltip to TabItem on hover
- [x] Add pause icon to TabItem (for paused/waiting threads)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Comment out ContentPaneHeader

**File:** `src/components/content-pane/content-pane.tsx` (lines 140-147)

Comment out the `<ContentPaneHeader>` render in ContentPane. This removes the entire header bar (breadcrumb, status dot, cancel button, tab toggle, close/pop-out buttons) for all view types.

Note: The cancel button and tab toggle (conversation/changes) currently live in the header. We're commenting out for now — these will need to move somewhere eventually. The close button is redundant with the tab close button.

```tsx
{/* Commented out: header content moved to tab tooltip
<ContentPaneHeader
  view={view}
  threadTab={threadTab}
  onThreadTabChange={setThreadTab}
  isStreaming={isStreaming}
  onClose={onClose}
  onPopOut={onPopOut}
/>
*/}
```

## Phase 2: Add breadcrumb tooltip to TabItem

**File:** `src/components/split-layout/tab-item.tsx`

Add a new `useTabTooltip(view)` hook that builds the breadcrumb path string:
- Format: `repoName / worktreeName / category / itemLabel` (same info as the Breadcrumb component)
- Skip worktreeName if it's "main"
- Use the same stores as `useBreadcrumbContext` + thread/plan name derivation

Apply via the native `title` attribute on the tab `<button>` element. Simple, no extra dependency needed.

**New hook:** `src/components/split-layout/use-tab-tooltip.ts`

```ts
export function useTabTooltip(view: ContentPaneView): string {
  // Pull repo/worktree names from lookup store
  // Pull thread/plan names from entity stores
  // Build "repo / worktree / threads / name" string
}
```

The hook will read:
- `useRepoWorktreeLookupStore` for repo/worktree names (needs repoId/worktreeId from thread/plan stores)
- `useThreadStore` for thread name (thread views)
- `usePlanStore` for plan name (plan views)
- For other view types, fall back to the tab label

## Phase 3: Add pause icon to TabItem

**File:** `src/components/split-layout/tab-item.tsx`

The existing `StatusDot` in TabItem shows:
- Green pulsing dot for `streaming`
- Green solid dot for `running`
- Hidden for `idle`

Add a `Pause` icon from lucide-react for when the thread status is `"paused"` (which maps to the agent waiting for user input / permission). Currently the code maps `"paused"` → `"running"` status in `useTabStatus`. Change this to show a distinct pause indicator.

Update `useTabStatus` to return `"paused"` as a distinct state, and update `StatusDot` to render a small pause icon (lucide `Pause` or `CirclePause`) for that state.
