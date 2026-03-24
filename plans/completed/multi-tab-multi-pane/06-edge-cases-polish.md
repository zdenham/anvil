# 06 — Edge Cases & Polish

**Wave 4 (sequential)** — Depends on all previous sub-plans.

## Goal

Handle all edge cases, enforce constraints, and verify the full system works end-to-end. This is the integration and hardening pass.

## Edge Cases to Handle

### 1. Archive Events — Close All Matching Tabs

**Problem**: `THREAD_ARCHIVED` / `PLAN_ARCHIVED` events must close tabs showing archived content across all groups.

**File to create/modify**: `src/stores/pane-layout/listeners.ts`

**Implementation**:
- Listen for archive events (same events the current `content-panes/listeners.ts` handles)
- Iterate all groups and all tabs
- Close any tab whose view references the archived entity (match by `threadId` / `planId`)
- If closing leaves a group empty, remove the group and collapse the split
- If the last group is removed, reset to default state

### 2. Max 5 Tabs Per Group

**Problem**: Too many tabs clutters the bar.

**Implementation** (in `paneLayoutService.openTab`):
- Before adding a tab, check `group.tabs.length >= 5`
- If at cap, close the leftmost tab (index 0) before adding the new one
- The leftmost eviction is simple and predictable

### 3. Visible Thread Tabs Stay Active

**Problem**: With multiple thread tabs across groups, all visible ones should receive streaming updates, not just the focused one.

**Implementation**:
- Export `getVisibleThreadIds()` selector from pane-layout store (defined in 01)
- Any system that currently checks `activeThreadId` to gate updates should also check visible thread IDs
- The existing `threadStates` record already supports multiple threads loaded simultaneously
- `activeThreadId` continues to track keyboard focus (active tab in active group)
- Streaming, status updates, and state syncing apply to all visible threads

### 4. Split Depth Constraints (4 Wide, 3 High)

**Problem**: Prevent infinite nesting.

**Implementation** (using `constraints.ts` from 01):
- Before any split operation, validate with `canSplitHorizontal` / `canSplitVertical`
- If at limit, refuse the split — don't show drop zones (05), disable split menu items
- Show a toast notification if user attempts to exceed limits

### 5. Resize Handle Minimum Sizes

**Problem**: Users could resize a group to be impossibly small.

**Implementation** (in `SplitResizeHandle` from 02):
- Enforce minimum ~15% per child during drag
- When a resize would violate this, clamp the values
- Optional: when dragged below a collapse threshold (~50px), treat as close/collapse

### 6. Content Search (Cmd+F) Scoping

**Problem**: Which pane does Cmd+F search?

**Solution**: Find bar is already scoped per `ContentPane` instance. The active group's active tab receives keyboard focus, so Cmd+F naturally targets it. No changes needed — just verify it works.

### 7. Pop-Out Behavior

**Problem**: Pop-out currently opens the view in a new Tauri window.

**Solution**: Keep the same behavior. Pop-out opens a standalone window for the active tab's view. The tab stays in the group. No changes needed to pop-out logic, just verify the view is read from the correct source (active tab in active group, not the old single pane).

### 8. InputStoreProvider Scoping

**Problem**: Each visible pane group needs its own input store.

**Solution**: `PaneGroup` (from 03) already wraps content in `InputStoreProvider`. Verify the `active` prop is `true` only for the active group's active tab. Other groups' input stores exist but are inactive.

### 9. Cmd+W to Close Active Tab

**Implementation**:
- Add keyboard shortcut handler for `Cmd+W`
- Calls `paneLayoutService.closeTab(activeGroupId, activeTabId)`
- Standard tab close behavior applies (left-neighbor activation, collapse empty group)

### 10. Persistence Round-Trip Verification

**Verify**:
- Save state to `~/.anvil/ui/pane-layout.json`
- Restart app → state hydrates correctly
- All tabs, groups, splits, active states restored
- Ephemeral fields (`autoFocus`) stripped on save
- Invalid JSON → falls back to default state
- Split with multiple groups and tabs survives round-trip

### 11. Old Store Cleanup

**Remove/deprecate**:
- Remove imports of `contentPanesService` from all files (grep for usage)
- Remove imports of `useContentPanesStore` from all files
- Can keep the old store files in place temporarily but ensure nothing references them
- Update `main-window-layout.tsx` to no longer initialize old store

## Files to Create

```
src/stores/pane-layout/listeners.ts  — Archive event handling for multi-tab
```

## Files to Modify

- `src/stores/pane-layout/service.ts` — Max 5 tab enforcement (if not already in 01)
- Various files importing `contentPanesService` — Switch to `paneLayoutService`
- Keyboard shortcut registration — Add Cmd+W handler

## Phases

- [x] Create `listeners.ts` for archive events across all groups/tabs
- [x] Verify and enforce max 5 tabs per group in service
- [x] Wire `getVisibleThreadIds()` so all visible thread tabs stay active
- [x] Add Cmd+W keyboard shortcut for close active tab
- [x] Verify persistence round-trips (save/restore with multiple groups, splits, tabs)
- [x] Remove all references to old `content-panes/` store and service
- [x] End-to-end smoke test: open tabs, split, resize, close, archive, restart

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
