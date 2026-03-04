# Fix Sticky Diff Header Border Radius

## Problem

When scrolling a diff, the file header becomes sticky (`sticky top-0`). It has `rounded-t-lg` which creates visible rounded corners while stuck — content scrolling behind the header peeks through the corner gaps, looking broken.

**Root cause:** `file-header.tsx:43` always applies `rounded-t-lg`. There's no mechanism to remove it when the header is in its stuck state.

**Affected files:**
- `src/components/diff-viewer/file-header.tsx` — the header element (line 43)
- `src/components/diff-viewer/diff-file-card.tsx` — the card container (lines 55, 76, 211)

## Phases

- [x] Add `useIsSticky` hook to detect stuck state
- [x] Wire hook into FileHeader and conditionally remove border-radius
- [x] Verify collapsed state still works correctly

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Approach

### Phase 1: Add `useIsSticky` hook

Create a small hook using IntersectionObserver + a sentinel element to detect when the sticky header is stuck:

**New file:** `src/hooks/use-is-sticky.ts`

```ts
import { useRef, useState, useEffect } from "react";

/**
 * Detects whether a sticky-positioned element is currently "stuck".
 * Returns [sentinelRef, isSticky].
 *
 * Place the sentinel element immediately before the sticky element.
 * When it scrolls out of view, the header must be stuck.
 */
export function useIsSticky(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isSticky, setIsSticky] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsSticky(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [sentinelRef, isSticky];
}
```

The sentinel is a zero-height div placed just above the header inside the card container. When the user scrolls past it, the observer fires and we know the header is stuck.

### Phase 2: Wire into FileHeader

In `diff-file-card.tsx`, for each card variant (binary at line 52, empty at line 73, content at line 207):

1. Call `useIsSticky()` to get `[sentinelRef, isSticky]`
2. Render `<div ref={sentinelRef} className="h-0" />` immediately before `<FileHeader>`
3. Pass `isSticky` as a new prop to `<FileHeader>`

In `file-header.tsx`:

1. Add `isSticky?: boolean` to `FileHeaderProps`
2. On line 43, conditionally remove `rounded-t-lg` when `isSticky` is true:

```ts
className={cn(
  "group flex items-center gap-2.5 px-3 py-1.5 bg-surface-800 sticky top-0 z-10 border-b border-surface-700 shadow-[0_2px_4px_-1px_rgba(0,0,0,0.3)]",
  !isSticky && "rounded-t-lg",
  onToggleCollapse && "cursor-pointer select-none",
  isCollapsed && "rounded-b-lg border-b-0 shadow-none",
)}
```

This means:
- **Not scrolled:** header has `rounded-t-lg` matching the card container's `rounded-lg`
- **Stuck:** header has square top corners, flush with the scroll container edges

### Phase 3: Verify collapsed state

When `isCollapsed` is true, the header also gets `rounded-b-lg`. This should still work correctly because:
- Not sticky + collapsed = `rounded-t-lg rounded-b-lg` (fully rounded, same as today)
- Sticky + collapsed = `rounded-b-lg` only (unusual edge case but still looks fine since it's a standalone bar)

No additional changes needed, just visual verification.

## Notes

- The `useIsSticky` hook is lightweight — one IntersectionObserver per file card
- The sentinel is a zero-height div, no layout impact
- `DiffFileCard` is already a memo component; the `isSticky` boolean change only triggers the header re-render via props, not the whole line list
- Binary and empty card variants in `DiffFileCard` (lines 50-67, 71-97) need the hook too since they also render `<FileHeader>` with sticky positioning. However, since hooks can't be called conditionally, the simplest approach is to call `useIsSticky()` once at the top of `DiffFileCard` before the early returns, and pass it through all branches.
