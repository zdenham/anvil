# Fix thread item left menu indicator

## Problem

In `thread-item.tsx`, folder items always show a chevron (green when running). The desired behavior:

- **Not selected**: Show a `StatusDot` (green dot when running, blue when unread, etc.) — no chevron
- **Selected + running**: Show a **green chevron** (`chevron-running` class) — indicates both expandable and running
- **Selected + not running**: Show a **regular chevron** — indicates expandable only

Currently `thread-item.tsx` (line 233) renders the chevron for all folders regardless of selection:
```tsx
{item.isFolder ? ( <chevron> ) : ( <StatusDot> )}
```

The correct pattern already exists in `plan-item.tsx` (line 285):
```tsx
{item.isFolder && isSelected ? ( <chevron> ) : ( <StatusDot> )}
```

## Phases

- [x] Update `thread-item.tsx` indicator logic to match plan-item pattern
- [x] Verify `chevron-running` CSS class is applied correctly when selected + running

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

### File: `src/components/tree-menu/thread-item.tsx`

**Change the conditional on line 233** from:

```tsx
{item.isFolder ? (
```

to:

```tsx
{item.isFolder && isSelected ? (
```

This single change makes the chevron only appear when the folder item is selected. When not selected, it falls through to the `StatusDot` which already handles the running variant (green dot with glow).

The `chevron-running` class (line 239) continues to apply the green color + pulse animation when `item.status === "running"`, so a selected + running folder will show a green animated chevron — conveying both expandability and running state simultaneously.

No CSS changes needed. No changes to `StatusDot` or other components.
