# Smooth follow-scroll: fold streaming into the virtualizer

## Problem

During streaming, scroll-follow is jittery. Root cause: streaming content lives **outside** the virtual list, requiring a second ResizeObserver that fights the virtualizer's own scroll-follow.

```
CURRENT: two systems fighting
┌─ scroller ──────────────────────────────┐
│  ┌─ spacer (height: totalHeight) ────┐  │
│  │  virtual item 0                   │  │
│  │  virtual item 1                   │  │
│  │  virtual item N ◄─ RO #1 (hook)   │  │
│  │     measures → subscriber →       │  │
│  │     scrollTo("smooth")       ─┐   │  │
│  └───────────────────────────────│──┘  │
│                                  │      │
│  streaming footer ◄─ RO #2      │      │
│     (message-list)               │      │
│     scrollTo("auto")  ───────┐   │      │
│                              ▼   ▼      │
│                TWO COMPETING SCROLLS    │
│                = jank                   │
└─────────────────────────────────────────┘
```

Three scroll paths fire near-simultaneously:
1. **Count-change effect** — `rAF` + `scrollTo("smooth")` on new turns
2. **Height-change subscriber** — sync `scrollTo("smooth")` when items resize
3. **Streaming RO** — `scrollTo("auto")` when footer grows

They cancel each other's animations → stutter.

## Solution

Fold streaming content into the virtual list as the last item. One RO, one scroll path, no conflicts.

```
AFTER: one system
┌─ scroller ──────────────────────────────┐
│  ┌─ spacer (height: totalHeight) ────┐  │
│  │  virtual item 0  → TurnRenderer   │  │
│  │  virtual item 1  → TurnRenderer   │  │
│  │  virtual item N  → TurnRenderer   │  │
│  │  virtual item N+1 → Streaming  ◄──│──│── same RO #1
│  │     measures → subscriber →       │  │
│  │     scrollTo ─────────────────┐   │  │
│  └───────────────────────────────│──┘  │
│                                  ▼      │
│                   ONE SCROLL PATH       │
│                   = smooth              │
└─────────────────────────────────────────┘
```

### How it works

Bump `count` by 1 when streaming content exists. The render loop checks index:

```
items.map(item =>
  item.index < turns.length
    ? <TurnRenderer turn={turns[item.index]} />
    : <StreamingContent />    ← the extra slot
)
```

The virtualizer's existing ResizeObserver measures the streaming slot as it grows, the existing subscriber handles follow-scroll. When streaming ends, the turn gets committed → `turns.length` increases, `hasStreamingContent` goes false, `count` stays the same, and the slot switches from `StreamingContent` to `TurnRenderer` in-place. No scroll jump because the height is already measured.

Same treatment for `WorkingIndicator` — it also gets the extra slot instead of living outside.

## Phases

- [x] Fold streaming content and working indicator into the virtual list
- [x] Switch follow-scroll to `"auto"` during streaming
- [x] Delete the streaming ResizeObserver and related refs from message-list
- [x] Verify no scroll jump on streaming-end transition

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fold streaming into the virtual list

In `message-list.tsx`:

**Compute count with streaming slot:**
```ts
const hasStreamingContent = useStreamingStore(/* ... existing ... */);

// +1 for the streaming/working slot when active
const showStreamingSlot = hasStreamingContent || showWorkingIndicator;
const virtualCount = turns.length + (showStreamingSlot ? 1 : 0);
```

**Pass to virtualizer:**
```ts
const { items, ... } = useVirtualList({
  count: virtualCount,  // was: turns.length
  ...
});
```

**Render loop — check if item is the streaming slot:**
```ts
items.map((item) => {
  const isStreamingSlot = item.index >= turns.length;

  return (
    <div key={item.key} ref={measureItem} data-index={item.index} style={...}>
      <div className={cn("px-4 py-2 w-full max-w-[900px] mx-auto", ...)}>
        {isStreamingSlot ? (
          hasStreamingContent
            ? <StreamingContent threadId={threadId} workingDirectory={workingDirectory} />
            : <WorkingIndicator />
        ) : (
          <TurnRenderer turn={turns[item.index]} ... />
        )}
      </div>
    </div>
  );
})
```

## Phase 2: Switch to `"auto"` during streaming

In `message-list.tsx`, the `followOutput` callback:

```ts
const followOutput = useCallback(
  (atBottom: boolean) => {
    if (isStreaming && atBottom) return "auto" as ScrollBehavior;  // was "smooth"
    return false as const;
  },
  [isStreaming],
);
```

`"smooth"` during continuous streaming keeps restarting CSS animations every frame. `"auto"` (instant) actually looks smoother because the viewport tracks content frame-by-frame without interrupting itself.

## Phase 3: Delete the old streaming RO

Remove from `message-list.tsx`:

- `isStreamingRef` + `isStickyRef` refs (lines 118-121)
- `streamingRoRef` (line 122)
- `streamingContentRef` callback with RO #2 (lines 124-145)
- Cleanup effect for `streamingRoRef` (lines 147-149)
- The footer JSX: `{hasStreamingContent && <div ref={streamingContentRef}>...}` (lines 195-205)
- The working indicator JSX block after it: `{!hasStreamingContent && showWorkingIndicator && ...}` (lines 206-209)

Both are now rendered inside the virtual list.

## Phase 4: Verify transition

When streaming ends:
- `hasStreamingContent` → false
- New turn committed → `turns.length` increases by 1
- `showStreamingSlot` → false
- `virtualCount` = `turns.length + 0` = same number as before

The slot that was rendering `StreamingContent` now renders `TurnRenderer` for the new turn. The virtualizer already has the measured height for that index. No layout shift, no scroll jump.

**Edge case to check:** if `turns.length` updates and `hasStreamingContent` goes false in different render cycles, `virtualCount` could briefly be wrong (count drops by 1 then goes back up). Verify these update atomically — if not, we may need to derive `showStreamingSlot` from the streaming store + turns together.

## Files to modify

- `src/components/thread/message-list.tsx` — all changes live here
- `src/hooks/use-virtual-list.ts` — no changes needed
- `src/lib/virtual-list.ts` — no changes needed

## Risk

Low. The virtualizer is already designed to handle variable-height items that resize. We're just feeding it one more item. The only risk is the streaming-end transition timing (Phase 4 edge case), which is verifiable.
