# Fix Panel Width Flash on Open

## Problem

When left or right side panels open, they visibly "jump" between two widths. This happens because `ResizablePanel` has **two competing width calculations**:

1. **Frame 1 (synchronous)**: `useState(() => getInitialWidth(defaultWidth, minWidth))` — renders at a computed default (e.g., `window.innerWidth / 3` for left panel, `250px` for right panel)
2. **Frame 2+ (async)**: A `useEffect` reads persisted width from `~/.anvil/ui/layout.json` via `appData.readJson()`, then calls `setWidth()` with the persisted value

The async disk read in the `useEffect` always fires *after* the first paint, causing a visible width jump.

## Root Cause

There are **two independent systems** managing panel widths:

1. **`ResizablePanel`** (`src/components/ui/resizable-panel.tsx:101-115`) — reads `ui/layout.json` directly in its own `useEffect` on every mount
2. **`useLayoutStore` + `layoutService`** (`src/stores/layout/`) — a proper Zustand store hydrated once at app startup in `MainWindowLayout`

`ResizablePanel` doesn't use `useLayoutStore` at all. It re-reads from disk independently, which is both redundant and causes the flash since the async read completes after the first render.

## Fix

Connect `ResizablePanel` to `useLayoutStore` so it gets the persisted width **synchronously on first render** (the store is already hydrated before any panels mount).

## Phases

- [x] Refactor `ResizablePanel` to read initial width from `useLayoutStore` instead of async disk read
- [x] Refactor `ResizablePanel` to write width changes through `layoutService.setPanelWidth()` instead of its own `persistWidth` function
- [x] Remove the redundant `LayoutStateSchema`, `LAYOUT_PATH`, and `loadWidth` useEffect from `resizable-panel.tsx`
- [ ] Verify left panel (`persistKey="tree-panel-width"`, `defaultWidth="1/3"`) and right panel (`persistKey="right-panel-width"`, `defaultWidth={250}`) both open without flash

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Detail

### `ResizablePanel` changes (`src/components/ui/resizable-panel.tsx`)

**Before:**
```tsx
const [width, setWidth] = useState(() => getInitialWidth(defaultWidth, minWidth));

// Async disk read — causes flash
useEffect(() => {
  async function loadWidth() {
    const raw = await appData.readJson(LAYOUT_PATH);
    const result = LayoutStateSchema.safeParse(raw);
    if (result.success && result.data.panelWidths[persistKey]) {
      setWidth(result.data.panelWidths[persistKey]);
    }
  }
  loadWidth();
}, [persistKey, defaultWidth]);
```

**After:**
```tsx
import { useLayoutStore } from "@/stores/layout/store";
import { layoutService } from "@/stores/layout/service";

// Read from already-hydrated store — no flash
const persistedWidth = useLayoutStore((s) => s.panelWidths[persistKey]);
const [width, setWidth] = useState(() =>
  persistedWidth ?? getInitialWidth(defaultWidth, minWidth)
);

// No useEffect for loading — store is already hydrated
```

And for persistence, replace the manual `persistWidth` callback with:
```tsx
const handleDragEnd = useCallback(() => {
  setIsDragging(false);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  layoutService.setPanelWidth(persistKey, width);
}, [width, persistKey]);
```

This removes `appData` import, `LayoutStateSchema`, `LAYOUT_PATH`, and the `loadWidth` useEffect entirely from `resizable-panel.tsx`. The `layoutService` already handles debounced persistence.

### Timing guarantee

`layoutService.hydrate()` is called in `MainWindowLayout`'s `initStores()` `useEffect`. The left panel is always visible on mount (`leftPanelOpen` defaults to `true`), and the right panel only opens on user action (after hydration completes). So the store will always have the persisted widths before `ResizablePanel` first renders.

**Edge case**: The left panel mounts simultaneously with the `initStores` effect on the very first render. If `hydrate()` hasn't resolved yet, `persistedWidth` will be `undefined` and it falls back to `getInitialWidth(defaultWidth, minWidth)` — same as current behavior. Once hydrated, the store update triggers a re-render with the correct width. This is still better than the current approach because the Zustand store update is synchronous (no async `useEffect` needed), and in practice hydration from a local file completes before the panel is visible.

To fully eliminate even this edge case, we could sync-read the layout width from the store's `_hydrated` flag and defer rendering. But that's likely unnecessary — the disk read is fast enough that it resolves before paint.
