# Make Panel Split Drop Zones Larger

## Problem

When dragging a tab to split a pane, the drop zones (top/bottom/left/right edges) are only 30px wide — a fixed pixel value regardless of panel size. On large panels this makes the zones feel tiny and hard to hit. They should be proportional to the panel dimensions (e.g. 30% of width/height).

## Changes

### 1. Proportional edge detection (`use-tab-dnd.ts`)

Replace the fixed `EDGE_THRESHOLD = 30` with percentage-based thresholds computed from the panel's actual dimensions.

**Current** (lines 94–106):
```ts
const EDGE_THRESHOLD = 30; // fixed 30px

if (contentRelY < EDGE_THRESHOLD && canV) return { groupId, zone: "top" };
if (contentRelY > contentHeight - EDGE_THRESHOLD && canV) return { groupId, zone: "bottom" };
if (relX < EDGE_THRESHOLD && canH) return { groupId, zone: "left" };
if (relX > rect.width - EDGE_THRESHOLD && canH) return { groupId, zone: "right" };
```

**Proposed:**
```ts
const EDGE_FRACTION = 0.3; // 30% of dimension
const MIN_EDGE_PX = 30;    // floor so small panels stay usable

const edgeY = Math.max(contentHeight * EDGE_FRACTION, MIN_EDGE_PX);
const edgeX = Math.max(rect.width * EDGE_FRACTION, MIN_EDGE_PX);

if (contentRelY < edgeY && canV) return { groupId, zone: "top" };
if (contentRelY > contentHeight - edgeY && canV) return { groupId, zone: "bottom" };
if (relX < edgeX && canH) return { groupId, zone: "left" };
if (relX > rect.width - edgeX && canH) return { groupId, zone: "right" };
```

Note: when top+bottom (or left+right) zones overlap (panel < 2×MIN_EDGE_PX), the first match wins — top/left take priority, which is fine.

### 2. Move overlay into content area (`pane-group.tsx`)

Currently the `DropZoneOverlay` is a sibling of `TabBar` inside `PaneGroup`, and `absolute inset-0` stretches it over the **entire** panel — including the tab bar. With 30% sizing the "top" zone would visually cover the tabs, and "left"/"right" zones span the full height too.

**Fix:** Move `DropZoneOverlay` inside the content wrapper div and add `relative` to that div so the overlay scopes to the content area only.

**Current** (`pane-group.tsx`):
```tsx
<TabBar ... />
<InputStoreProvider ...>
  <div className="flex-1 min-h-0">
    <ContentPane ... />
  </div>
</InputStoreProvider>
{activeDrag && (
  <DropZoneOverlay ... />
)}
```

**Proposed:**
```tsx
<TabBar ... />
<InputStoreProvider ...>
  <div className="relative flex-1 min-h-0">
    <ContentPane ... />
    {activeDrag && (
      <DropZoneOverlay ... />
    )}
  </div>
</InputStoreProvider>
```

Now `inset-0` on the overlay is relative to the content area, not the full panel. The 30% sizing in the next step will be correct automatically.

### 3. Match visual overlay (`drop-zone-overlay.tsx`)

Replace the hardcoded `h-[30px]` / `w-[30px]` Tailwind classes with percentage-based sizing:
```ts
const positionClasses: Record<string, string> = {
  top:    "top-0 left-0 right-0 h-[30%]",
  bottom: "bottom-0 left-0 right-0 h-[30%]",
  left:   "top-0 left-0 bottom-0 w-[30%]",
  right:  "top-0 right-0 bottom-0 w-[30%]",
};
```

Since the overlay is now scoped to the content area, 30% of the overlay ≈ 30% of contentHeight/width, matching the detection logic. The MIN_EDGE_PX floor only matters for tiny panels where precision is less important.

## Files

- `src/components/split-layout/use-tab-dnd.ts` — proportional edge detection
- `src/components/split-layout/pane-group.tsx` — move overlay into content area
- `src/components/split-layout/drop-zone-overlay.tsx` — proportional visual indicators

## Phases

- [x] Update edge detection in `use-tab-dnd.ts` to use percentage-based thresholds
- [x] Move `DropZoneOverlay` into content wrapper div in `pane-group.tsx`
- [x] Update visual overlay in `drop-zone-overlay.tsx` to use percentage-based sizing

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
