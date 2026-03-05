# Fix scroll-to-bottom triggered by tool block expand/collapse

## Problem

Expanding a tool block sometimes triggers the sticky auto-scroll, jumping the viewport to the bottom of the thread. This is jarring because the user expanded a block to read its content, not to scroll away from it.

### Root cause

The `onContentGrew` subscriber in `useVirtualList` (line 215-221) fires on **every** `list.subscribe()` notification — including height changes from expand/collapse. When sticky is true, this schedules a scroll-to-bottom via the `ScrollCoordinator`, pulling the user away from the expanded content.

The subscriber can't distinguish "streaming growth at the bottom" from "user expanded a tool block mid-list."

## Phases

- [x] Gate `onContentGrew` subscriber on `isRunning` prop
- [ ] Verify streaming auto-scroll still works correctly

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

### Phase 1: Gate `onContentGrew` on thread running state

**File:** `src/hooks/use-virtual-list.ts`

Add an `autoScrollOnGrowth` option to `UseVirtualListOptions`. When false, the `onContentGrew` subscriber is disabled — height changes from tool expand/collapse won't trigger scroll-to-bottom.

```typescript
// In UseVirtualListOptions:
/** When true, height growth triggers auto-scroll (use for streaming) */
autoScrollOnGrowth?: boolean;
```

Replace the existing `onContentGrew` subscriber effect (lines 215-221) to gate on `autoScrollOnGrowth` instead of just `sticky`:

```typescript
useEffect(() => {
  if (!opts.sticky || !opts.autoScrollOnGrowth) return;
  const unsub = list.subscribe(() => {
    coordinator.onContentGrew();
  });
  return unsub;
}, [list, coordinator, opts.sticky, opts.autoScrollOnGrowth]);
```

**File:** `src/components/thread/message-list.tsx`

Pass `isRunning` as `autoScrollOnGrowth`:

```typescript
const { items, ... } = useVirtualList({
  ...
  sticky: true,
  autoScrollOnGrowth: isRunning,
});
```

This means:
- **Thread running + content grows** → auto-scroll fires (streaming tokens) ✓
- **Thread idle + expand tool block** → auto-scroll suppressed ✓
- **Thread running + expand old tool block** → rare edge case, accepted

### Phase 2: Verify streaming

No code changes — manual verification that:
1. Streaming threads still auto-scroll to show new tokens
2. New message appearance still smooth-scrolls (handled by `onItemAdded`, unaffected)
3. Expanding a tool block mid-thread does NOT scroll to bottom

## Files to modify

- `src/hooks/use-virtual-list.ts` — Add `autoScrollOnGrowth` option, gate subscriber
- `src/components/thread/message-list.tsx` — Pass `isRunning` as `autoScrollOnGrowth`
