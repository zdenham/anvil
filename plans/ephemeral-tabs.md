# Ephemeral (Preview) Tabs

VS Code-style ephemeral tabs: single-click opens a "preview" tab (italic title) that gets replaced by the next preview open. Interacting with the tab pins it. Only one ephemeral tab per group.

## Behavior Summary

- **Single-click** sidebar/tree item → opens in the ephemeral tab slot (replaces previous ephemeral tab, or creates one)
- **Double-click** sidebar item or tab → pins the tab (no longer ephemeral)
- **Cmd+Click / middle-click** → opens a new pinned tab (existing behavior, unchanged)
- **Interacting** with content (typing in thread input, editing a file, dragging the tab) → auto-pins
- Only **one ephemeral tab per group** at any time
- Ephemeral tab renders with **italic title text**

## Phases

- [x] Phase 1: Data model — add `ephemeral` flag to TabItem

- [x] Phase 2: Store & service — ephemeral tab management

- [x] Phase 3: Navigation integration — sidebar clicks open ephemeral

- [x] Phase 4: UI — italic styling + double-click to pin

- [x] Phase 5: Auto-pin triggers — content interaction pins the tab

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Data Model

**File:** `core/types/pane-layout.ts`

Add optional `ephemeral` boolean to `TabItemSchema`:

```ts
export const TabItemSchema = z.object({
  id: z.string(),
  view: ContentPaneViewSchema,
  ephemeral: z.boolean().optional(),
});
```

This is backwards-compatible — existing persisted data without the field parses fine via `.optional()`.

## Phase 2: Store & Service

### Store (`src/stores/pane-layout/store.ts`)

Add one new mutation:

- `_applyPinTab(groupId, tabId)` — sets `ephemeral: undefined` on the tab (removes flag)

No other store changes needed — `_applyOpenTab`, `_applySetTabView`, `_applyCloseTab` all work on `TabItem` objects already and will carry the `ephemeral` field through.

### Defaults (`src/stores/pane-layout/defaults.ts`)

- `createTab(view, options?: { ephemeral?: boolean })` — pass-through to set the flag on creation

### Service (`src/stores/pane-layout/service.ts`)

Add new methods:

1. `pinTab(groupId, tabId)` — calls `_applyPinTab` + persist. Idempotent (no-op if already pinned).

2. `openEphemeralTab(view, groupId?)` — core ephemeral logic:

   - Find existing ephemeral tab in the target group
   - If found: replace its view via `_applySetTabView` and activate it
   - If not found: create a new tab with `ephemeral: true` and `_applyOpenTab`
   - Respects max-tabs limit (same as `openTab`)
   - If the view already exists as a pinned tab in any group, just activate that tab instead (same dedup as `findOrOpenTab`)

3. **Modify** `findOrOpenTab`: When `options.newTab` is falsy and no existing tab matches, call `openEphemeralTab` instead of `setActiveTabView`. This is the key behavioral change — regular navigation now uses the ephemeral slot.

### Persistence (`src/stores/pane-layout/service.ts`)

`stripEphemeral` already strips transient fields before persisting. The `ephemeral` flag **should be persisted** though (VS Code persists preview tab state), so no stripping needed — it's part of the schema.

### Helper: find ephemeral tab in group

```ts
function findEphemeralTab(group: PaneGroup): TabItem | undefined {
  return group.tabs.find(t => t.ephemeral);
}
```

## Phase 3: Navigation Integration

**File:** `src/stores/navigation-service.ts`

The key change: `openOrFind()` already delegates to `findOrOpenTab` for regular clicks and `openTab` for `newTab`. Since `findOrOpenTab` will now use ephemeral tabs internally, most navigation works automatically.

Add a `doubleClick` option to `NavigateOptions`:

```ts
export interface NavigateOptions {
  newTab?: boolean;
  autoFocus?: boolean;
  doubleClick?: boolean; // pin the tab after opening
}
```

When `doubleClick` is true, after opening the tab, call `paneLayoutService.pinTab()` on it. This handles the "double-click sidebar item = pin" behavior.

**File:** `src/components/main-window-layout.tsx` **(or wherever** `handleItemSelect` **lives)**

Pass `doubleClick: true` when the sidebar item is double-clicked. The tree/sidebar click handler likely needs to distinguish single vs double click. Two approaches:

- **Option A (simpler):** On double-click, if the tab is already open and ephemeral, pin it. The navigation service handles this.
- **Option B:** Use a click delay/debounce to distinguish single from double. This can feel laggy.

**Recommended: Option A.** Double-click fires two events: first single-click opens ephemeral, then double-click event pins it. This matches VS Code's behavior exactly — no delay needed on single clicks.

## Phase 4: UI — Italic Styling + Double-Click to Pin

**File:** `src/components/split-layout/tab-item.tsx`

1. **Italic label for ephemeral tabs:**
   - Accept `ephemeral` in props (derived from `tab.ephemeral`)
   - Add `italic` class to the label `<span>` when ephemeral

```tsx
<span className={cn("flex-1 truncate text-left", tab.ephemeral && "italic")}>
  {label}
</span>
```

2. **Double-click tab to pin:**
   - Add `onDoubleClick` handler that calls `paneLayoutService.pinTab(groupId, tab.id)`

```tsx
const handleDoubleClick = useCallback(() => {
  if (tab.ephemeral) {
    paneLayoutService.pinTab(groupId, tab.id);
  }
}, [groupId, tab.id, tab.ephemeral]);
```

3. **Drag should auto-pin:**
   - In the drag-start handler (in `use-tab-dnd.ts`), if the dragged tab is ephemeral, pin it first

## Phase 5: Auto-Pin Triggers

These ensure that interacting with content automatically pins the ephemeral tab.

### Thread input focus/typing

**File:** `src/components/content-pane/thread-content.tsx` **(or input component)**

When the user starts typing in the thread input, check if the current tab is ephemeral and pin it:

```ts
// On first keystroke or focus of input
const activeTab = getActiveTab();
const activeGroup = getActiveGroup();
if (activeTab?.ephemeral && activeGroup) {
  paneLayoutService.pinTab(activeGroup.id, activeTab.id);
}
```

### File editing

**File: wherever file edit events are handled**

When a file tab becomes dirty (first edit), pin the tab. The `useFileDirtyStore` already tracks this — hook into the transition from clean → dirty.

### General approach: `pinActiveTabIfEphemeral()` helper

Add a convenience method on `paneLayoutService`:

```ts
async pinActiveTabIfEphemeral(): Promise<void> {
  const group = getActiveGroup();
  const tab = getActiveTab();
  if (group && tab?.ephemeral) {
    await this.pinTab(group.id, tab.id);
  }
}
```

Then call it from:

- Thread input `onFocus` or first keystroke
- File content first edit
- Tab drag start
- Any other "user committed to this content" interaction

---

## Files Changed (Summary)

| File | Change |
| --- | --- |
| `core/types/pane-layout.ts` | Add `ephemeral?: boolean` to TabItemSchema |
| `src/stores/pane-layout/defaults.ts` | `createTab` accepts ephemeral option |
| `src/stores/pane-layout/store.ts` | Add `_applyPinTab` mutation |
| `src/stores/pane-layout/service.ts` | Add `pinTab`, `openEphemeralTab`, `pinActiveTabIfEphemeral`; modify `findOrOpenTab` |
| `src/stores/navigation-service.ts` | Add `doubleClick` option, wire through |
| `src/components/split-layout/tab-item.tsx` | Italic class + double-click handler |
| `src/components/split-layout/use-tab-dnd.ts` | Pin on drag start |
| Thread input component | Pin on focus/keystroke |
| File editor component | Pin on first edit |
| Sidebar double-click handler | Pass `doubleClick: true` to navigation |

## Edge Cases

- **Last ephemeral tab in group**: Replacing it works the same as replacing any tab's view — no structural change
- **Ephemeral + max tabs**: If the group is at 5 tabs and the ephemeral tab is being replaced (not a new tab), no eviction needed. If creating a new ephemeral tab at cap, evict leftmost non-ephemeral tab
- **Persistence**: Ephemeral state survives restart (matches VS Code). On hydration, if a group somehow has multiple ephemeral tabs (corruption), pin all but the last
- **Close ephemeral tab**: Works identically to closing any tab — no special behavior needed
- **Tab dedup**: If navigating to something that already exists as a pinned tab anywhere, activate that tab (don't create an ephemeral duplicate)
- **Empty view**: The default empty tab should NOT be ephemeral — it's a placeholder