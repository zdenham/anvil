# Clear Finder Highlights on Content Pane Change

## Problem

When the user opens the local finder (Cmd+F), searches, closes it, then navigates to a different content pane, the CSS Highlight API highlights persist visually. They should be cleared on any content panel change.

## Root Cause

`ContentPaneContainer` renders `ContentPane` without a `key` prop. When the user navigates to a different view (e.g., clicks a different thread or plan in the tree menu), React reuses the same component instance — it just updates props. This means:

- `findBarOpen` state persists across view changes
- `useContentSearch` internal state (query, ranges, CSS highlights) carries over
- The unmount cleanup in `useContentSearch` (`useEffect(() => clearHighlights, ...)`) never fires because the component doesn't unmount

The same issue exists in `ThreadContent` — switching between threads reuses the component without clearing thread search state.

## Fix

Add a `useEffect` in both `ContentPane` and `ThreadContent` that clears find state whenever the view identity changes.

## Phases

- [x] Add view-change cleanup to ContentPane
- [x] Add threadId-change cleanup to ThreadContent

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: ContentPane — clear find on view change

**File**: `src/components/content-pane/content-pane.tsx`

Derive a stable view identity key from the `view` prop, then add an effect that closes the find bar and clears search when it changes.

```tsx
// Derive stable identity from view — changes when navigating to different content
const viewKey =
  view.type === "thread" ? `thread:${view.threadId}` :
  view.type === "plan" ? `plan:${view.planId}` :
  view.type === "terminal" ? `terminal:${view.terminalId}` :
  view.type === "file" ? `file:${view.filePath}` :
  view.type === "pull-request" ? `pr:${view.prId}` :
  view.type === "changes" ? `changes:${view.repoId}:${view.worktreeId}` :
  view.type;

// Clear find state on any content pane change
useEffect(() => {
  search.clear();
  setFindBarOpen(false);
}, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps
```

Place this right after the existing `closeFindBar` definition (~line 124), before the return statement. The `search.clear` and `setFindBarOpen` refs are intentionally excluded from deps — we only want this to fire on view identity changes, not on every render.

## Phase 2: ThreadContent — clear find on thread change

**File**: `src/components/content-pane/thread-content.tsx`

Add the same pattern keyed on `threadId`:

```tsx
// Clear find state when switching threads
useEffect(() => {
  threadSearch.clear();
  setFindBarOpen(false);
}, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps
```

Place after the `closeFindBar` definition (~line 301).
