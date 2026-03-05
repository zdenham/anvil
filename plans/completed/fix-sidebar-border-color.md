# Fix Left Sidebar Border Color

The right border of the left sidebar (`border-surface-700` / `#3a3c3a`) appears too light against the `bg-surface-950` background, making it visually inconsistent with other structural borders.

## Change

In `src/components/main-window/main-window-layout.tsx` line 712, change:
```
border-r border-surface-700
```
to:
```
border-r border-surface-800
```

This uses `#1e201e` instead of `#3a3c3a` — a darker, more subtle divider that blends better with the deep panel backgrounds, matching the style used by the status legend divider (line 736) and toolbar borders.

## Phases

- [x] Update sidebar border class from `border-surface-700` to `border-surface-800`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
