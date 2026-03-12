# Fix: File sidebar click does not scroll diff to correct file

## Problem

When clicking a file in the sidebar while the changes/diff view is open, `ChangesView` calls `scrollToIndex(index)` on the virtualizer. The virtualizer computes the scroll target from `getScrollTarget()`, which uses prefix-sum offsets based on item heights. But most items haven't been measured yet — their heights are the estimate (200px).

If file cards are actually 400-2000px tall, the estimated offset for file index 20 is `20 * 200 = 4000px`, but the real offset might be `20 * 600 = 12000px`. The scroll lands at the wrong position.

After scrolling, items near the estimated position get rendered and measured (via ResizeObserver), but the scroll position is never corrected to account for the updated offsets.

## Files to Change

- `src/hooks/use-virtual-list.ts`

## Approach

Add a settle loop to `scrollToIndex` that retries after measurement. After the initial scroll, newly-rendered items get measured and heights shift. The loop re-calculates `getScrollTarget()` and scrolls again if the position changed. Uses double-`requestAnimationFrame` to run after the ResizeObserver callback (which fires before rAF per spec).

```typescript
const scrollToIndex = useCallback(
  (scrollOpts: ScrollToOptions) => {
    const el = opts.getScrollElement();
    if (!el) return;
    const { top, behavior } = list.getScrollTarget(scrollOpts);
    el.scrollTo({ top, behavior });

    // Settle loop: after scrolling, newly-rendered items get measured,
    // shifting offsets. Re-scroll until the target position stabilizes.
    let attempts = 0;
    const settle = () => {
      if (attempts >= 3) return;
      attempts++;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const { top: newTop } = list.getScrollTarget(scrollOpts);
          if (Math.abs(newTop - el.scrollTop) > 5) {
            el.scrollTo({ top: newTop, behavior: "auto" });
            settle();
          }
        });
      });
    };
    settle();
  },
  [list, opts.getScrollElement],
);
```

This also improves thread view's `scrollToIndex` and find navigation, since both use the same hook.

## Phases

- [ ] Add settle loop to `scrollToIndex` in `use-virtual-list.ts`

- [ ] Manually test file sidebar click in changes view scrolls to correct file

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---