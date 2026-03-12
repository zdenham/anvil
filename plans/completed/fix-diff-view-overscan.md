# Fix: Diff view lines appear late when scrolling (insufficient overscan)

## Problem

The virtualizer in `ChangesDiffContent` uses `overscan: 400` (400px above/below the viewport). Since file cards are estimated at 200px but often much taller (500-2000px for real diffs), the overscan might only cover 0-1 extra file cards. When scrolling quickly, users see blank space where file cards haven't rendered yet — lines "do not appear until well within the viewport."

## Files to Change

- `src/components/changes/changes-diff-content.tsx`

## Approach

Increase overscan from 400 to 1200px. This provides \~2-6 extra file cards of pre-rendering buffer (depending on actual card sizes), making content appear before it enters the viewport during normal scrolling.

```diff
  const { items, paddingBefore, paddingAfter, scrollToIndex, measureItem } = useVirtualList({
    count: files.length,
    getScrollElement,
    estimateHeight: 200,
-   overscan: 400,
+   overscan: 2400,
  });
```

1200px is a reasonable balance — enough to cover 2-3 average file cards while not rendering so many items that performance degrades.

## Phases

- [x] Increase overscan from 400 to 2400 in `changes-diff-content.tsx`

- [ ] Manually test scrolling in diff view for smoother pre-rendering

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---