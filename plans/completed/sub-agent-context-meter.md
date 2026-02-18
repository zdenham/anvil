# Sub-Agent Context Meter

Show the context meter in sub-agent (child) thread views, right-justified next to the "Back to parent" button.

## Problem

When viewing a sub-agent thread, the `ThreadInputSection` (which contains the `ThreadInputStatusBar` with the `ContextMeter`) is hidden because sub-agent threads are read-only. This means there's no visibility into the sub-agent's context usage.

## Approach

Add the `ContextMeter` to the `BackToParentButton` row in `thread-content.tsx`. The back button already renders at the bottom of sub-agent views — we just need to make the row a flex container with the back button on the left and the context meter on the right.

### Changes

**`src/components/content-pane/thread-content.tsx`**

1. Import `ContextMeter` from `@/components/content-pane/context-meter`
2. Update the `BackToParentButton` component to accept a `threadId` prop (the sub-agent's own thread ID)
3. Make the outer `div` a flex row with `justify-between` so the back button sits left and the context meter sits right
4. Render `<ContextMeter threadId={threadId} />` on the right side of that row

Before:
```tsx
<div className="py-3 px-2">
  <button ...>
    <ArrowLeft /> Back to {parentThread?.name}
  </button>
</div>
```

After:
```tsx
<div className="flex items-center justify-between py-3 px-2">
  <button ...>
    <ArrowLeft /> Back to {parentThread?.name}
  </button>
  <ContextMeter threadId={threadId} />
</div>
```

5. Update the call site to pass `threadId`:
```tsx
{isSubAgent && activeMetadata?.parentThreadId && (
  <BackToParentButton
    parentThreadId={activeMetadata.parentThreadId}
    threadId={threadId}
  />
)}
```

## Phases

- [x] Add ContextMeter to BackToParentButton in thread-content.tsx

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Notes

- Single-file change, all within `thread-content.tsx`
- The `ContextMeter` component is self-contained — it reads usage data from the thread store using the provided `threadId`
- If the sub-agent hasn't made any API calls yet, `ContextMeter` returns `null` (graceful no-op)
- No new dependencies or components needed
