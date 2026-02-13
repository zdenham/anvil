# Fix Code Diffs Button in Content Pane

## Problem

The GitCompare button in the top-right of the thread panel header toggles a `threadTab` state between `"conversation"` and `"changes"`, but the `ContentPane` component **never checks this state** when rendering. It always renders `<ThreadContent>` regardless of the tab value. The button appears to do nothing.

### Root Cause

In `src/components/content-pane/content-pane.tsx` (lines 92-111), the thread view rendering ignores `threadTab`:

```tsx
// Always renders ThreadContent, regardless of threadTab value
{view.type === "thread" && (() => {
  return (
    <ThreadContent
      threadId={view.threadId}
      onPopOut={onPopOut}
      autoFocus={view.autoFocus}
      initialPrompt={initialPrompt}
    />
  );
})()}
```

Meanwhile, the **working** implementation in `control-panel-window.tsx` (lines 649-667) correctly switches:

```tsx
{threadTab === "conversation" && <ThreadView ... />}
{threadTab === "changes" && activeMetadata && <ChangesTab ... />}
```

### What's Missing

The `ChangesTab` component requires three props:
- `threadMetadata` — available from `useThreadStore(s => s.threads[threadId])`
- `threadState` — available from `useThreadStore(s => s.threadStates[threadId])`
- `isLoadingThreadState` — available from `useThreadStore(s => s.activeThreadLoading)`

All three are **already subscribed to** inside `ThreadContent` (lines 116-135), but `ContentPane` doesn't read them itself and doesn't pass `threadTab` down to `ThreadContent`.

## Phases

- [x] Wire up conditional rendering in ContentPane based on threadTab
- [x] Verify the fix works end-to-end

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Wire up conditional rendering in ContentPane

**File:** `src/components/content-pane/content-pane.tsx`

### Changes

1. **Import `ChangesTab`** from `@/components/control-panel/changes-tab`

2. **Add store selectors** for the data `ChangesTab` needs. These should be scoped to only subscribe when the view is a thread:
   ```tsx
   const threadId = view.type === "thread" ? view.threadId : null;

   const activeMetadata = useThreadStore(
     useCallback((s) => (threadId ? s.threads[threadId] : undefined), [threadId])
   );
   const activeState = useThreadStore(
     useCallback((s) => (threadId ? s.threadStates[threadId] : undefined), [threadId])
   );
   const isLoadingThreadState = useThreadStore((s) => s.activeThreadLoading);
   ```
   Note: `activeMetadata` is already partially derived for `initialPrompt` — refactor slightly to extract it as a standalone selector, then derive `initialPrompt` from it.

3. **Conditionally render** `ThreadContent` vs `ChangesTab` based on `threadTab`:
   ```tsx
   {view.type === "thread" && threadTab === "conversation" && (
     <ThreadContent
       threadId={view.threadId}
       onPopOut={onPopOut}
       autoFocus={view.autoFocus}
       initialPrompt={initialPrompt}
     />
   )}
   {view.type === "thread" && threadTab === "changes" && activeMetadata && (
     <ChangesTab
       threadMetadata={activeMetadata}
       threadState={activeState}
       isLoadingThreadState={isLoadingThreadState}
     />
   )}
   ```

4. **Remove verbose timing IIFE** — the current `(() => { ... })()` wrapper around ThreadContent is only there for logging and can be replaced with the simple conditional above (clean up the debug noise).

### Edge Cases to Handle

- If `activeMetadata` is undefined when switching to changes tab, `ChangesTab` won't render — this is correct behavior (same as control-panel).
- The `threadTab` state resets to `"conversation"` when the component remounts (new thread selected), which is correct default behavior.

## Phase 2: Verify the fix works end-to-end

1. Run `pnpm typecheck` to confirm no type errors
2. Check logs to confirm `ChangesTab` renders and attempts diff generation when the button is clicked
3. Verify switching back to conversation tab still shows `ThreadContent` correctly
