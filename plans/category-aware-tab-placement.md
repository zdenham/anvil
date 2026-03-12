# Category-Aware Tab Placement

## Problem

When opening a new item (e.g., a thread), the current logic replaces the **active tab in the active group** — regardless of what kind of content is in that tab. If the user last interacted with a terminal in the bottom pane, opening a new thread replaces the terminal instead of the thread in the top pane.

The user expects threads to replace threads and terminals to replace terminals.

## Current Flow

The key path is `navigationService` → `paneLayoutService.findOrOpenTab()` → `setActiveTabView()`.

1. `findOrOpenTab` searches **all groups** for an existing tab matching the view (dedup).
2. If not found and `newTab` is false, it calls `setActiveTabView`, which replaces the **active tab in the active group** — whichever group was last interacted with.
3. Terminals use a separate path: `openInBottomPane`, which targets the bottom-most vertical leaf.

The problem: `setActiveTabView` is group-agnostic and type-agnostic. It just replaces whatever tab is active in whatever group is active.

## Design

### View Categories

Introduce a simple category concept:

```typescript
type ViewCategory = "terminal" | "content";

function getViewCategory(type: ContentPaneView["type"]): ViewCategory {
  return type === "terminal" ? "terminal" : "content";
}
```

### Category-Aware Replacement in `findOrOpenTab`

When no existing tab matches (the "replace active" path), instead of blindly replacing the active tab in the active group, find the **best group** to replace in:

1. **Same-category active tab in any group** — prefer the group whose active tab matches the new view's category. If multiple groups qualify, prefer the group that was most recently active (see below).
2. **Fallback** — if no group has an active tab of the matching category, fall back to the current behavior (replace active tab in active group).

### Tracking Per-Category Last-Active Group

Add a lightweight `lastActiveGroupByCategory` map to the pane layout store:

```typescript
// In PaneLayoutPersistedState or ephemeral state
lastActiveGroupByCategory: Record<ViewCategory, string | null>;
```

Update this whenever `_applySetActiveGroup` is called — record which category was last active in that group, and update the map. This is O(1) and doesn't change any existing behavior.

### Changes Required

`src/stores/pane-layout/store.ts`

- Add `lastActiveGroupByCategory: { terminal: string | null; content: string | null }` to state.
- In `_applySetActiveGroup`, look at the newly-active group's active tab to determine its category, then update the map.

`src/stores/pane-layout/service.ts` — `findOrOpenTab`

- After the "search all groups" loop finds no match:
  - Determine the new view's category.
  - Look up `lastActiveGroupByCategory[category]` to find the preferred group.
  - If that group exists and its active tab is the same category, replace that tab (via `_applySetTabView`).
  - Otherwise, fall back to current behavior (replace active tab in active group).

`src/stores/pane-layout/types.ts`

- Add `lastActiveGroupByCategory` to the persisted state schema (optional field for backward compat).

`src/components/content-pane/types.ts`

- Add `getViewCategory` helper function.

### Terminal `openInBottomPane` — No Change Needed

The existing `openInBottomPane` already correctly targets the bottom pane. The `bottomPane: true` option in `navigateToTerminal` bypasses `findOrOpenTab` entirely, so terminal-opening-from-sidebar already works correctly. The new logic only affects the non-`bottomPane` path (i.e., `findOrOpenTab` / `setActiveTabView`).

## Example Scenarios

**Current (broken):**

1. User has thread in top pane, terminal in bottom pane.
2. User clicks terminal (bottom pane becomes active group).
3. User clicks a thread in sidebar → `findOrOpenTab` → `setActiveTabView` replaces the terminal with the thread.

**After fix:**

1. Same setup.
2. User clicks terminal (bottom pane becomes active group). `lastActiveGroupByCategory` updates: `{ terminal: bottomGroupId, content: topGroupId }`.
3. User clicks thread in sidebar → `findOrOpenTab` → looks up `lastActiveGroupByCategory["content"]` → finds topGroupId → replaces the thread tab in the top pane.

## Phases

- [x] Add `getViewCategory` helper and `lastActiveGroupByCategory` to store/types

- [x] Update `_applySetActiveGroup` to track per-category last-active group

- [x] Update `findOrOpenTab` to use category-aware group selection

- [ ] Add unit tests for category-aware tab placement

- [ ] Manual verification with top/bottom pane layout

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Edge Cases

- **Single group (no split):** `lastActiveGroupByCategory` will have the same group for both categories → falls back to current behavior (replace active tab). Correct.
- **Group removed:** If `lastActiveGroupByCategory` points to a deleted group, the lookup fails and we fall back to the active group. Need to clear stale entries in `_applyRemoveGroup`.
- **Empty tabs:** An `{ type: "empty" }` tab is `"content"` category. Replacing it with a thread is the expected behavior.
- **Hydration:** Reconstruct `lastActiveGroupByCategory` from the active group's active tab on hydrate, or just start fresh (ephemeral state is fine too — first interaction populates it).