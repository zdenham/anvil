# 04 — Navigation Wiring

**Wave 3 (parallel with 05-dnd-system)** — Depends on 01-foundation-store, 02-split-layout-renderer, 03-tab-system.

## Goal

Refactor the navigation service to use the new pane-layout service. Add Cmd+Click for new tab. Implement find-and-focus tab dedup. Update tree selection sync to track the active group's active tab.

## Context

**Modifies**: `src/stores/navigation-service.ts`

**Current behavior**: Every `navigateTo*()` method calls `contentPanesService.setActivePaneView(view)` which replaces the single pane's view.

**New behavior**:
- **Regular click**: `paneLayoutService.findOrOpenTab(view)` — searches all groups for an existing tab with this view, focuses it if found, otherwise replaces the active tab's view.
- **Cmd+Click**: `paneLayoutService.openTab(view)` — always opens a new tab in the active group.

## Files to Modify

```
src/stores/navigation-service.ts         — Switch from contentPanesService to paneLayoutService
src/components/main-window/main-window-layout.tsx — Update store hydration
```

## Files to Create/Modify for Cmd+Click

All sidebar click handlers that call `navigationService.navigateTo*()` need to detect Cmd+Click and pass `{ newTab: true }`.

Key locations:
- `src/components/main-window/main-window-layout.tsx` — `onItemSelect` handler
- Any other components that call `navigationService.navigateTo*()` (search via grep for `navigationService.navigate`)

## Navigation Service Changes

Add `options.newTab` to all `navigateTo*` methods:

```typescript
interface NavigateOptions {
  newTab?: boolean;   // Cmd+Click → open in new tab
  autoFocus?: boolean; // For threads
}

export const navigationService = {
  async navigateToThread(threadId: string, options?: NavigateOptions): Promise<void> {
    await treeMenuService.setSelectedItem(threadId);
    const view = { type: "thread", threadId, autoFocus: options?.autoFocus };

    if (options?.newTab) {
      await paneLayoutService.openTab(view);
    } else {
      await paneLayoutService.findOrOpenTab(view);
    }
  },

  // Same pattern for navigateToPlan, navigateToFile, navigateToTerminal, etc.
  // ...

  async navigateToView(view: ContentPaneView, options?: NavigateOptions): Promise<void> {
    // Dispatch to specific navigateTo* or handle directly
    // Pass newTab through
  },
};
```

## Tab Dedup Logic (`findOrOpenTab`)

Already defined in 01-foundation-store's service, but the matching logic is important:

```typescript
// View matching for dedup:
// - thread: match by threadId
// - plan: match by planId
// - terminal: match by terminalId
// - file: match by filePath
// - pull-request: match by prId
// - changes: match by repoId + worktreeId
// - settings/logs/archive: match by type (only one of each)
// - empty: never matches (each empty tab is unique)
```

## Tree Selection Sync

When the active group or active tab changes, the sidebar selection must update to reflect it.

**Current**: Sidebar selection is set explicitly in each `navigateTo*()` call.

**Additional case**: When the user clicks a tab (not through navigation), the sidebar should update. Add a `usePaneLayoutStore` subscription that syncs:

```typescript
// In a new effect or listener:
// When activeGroupId or the active group's activeTabId changes,
// derive the corresponding tree item ID and call treeMenuService.setSelectedItem()
```

The mapping from view → tree item ID:
- `thread` → `threadId`
- `plan` → `planId`
- `terminal` → `terminalId`
- `pull-request` → `prId`
- `changes` → the treeItemId (may need to store this, or derive from repoId+worktreeId)
- `file`, `settings`, `logs`, `archive`, `empty` → `null` (no tree item)

## MainWindowLayout Hydration

Update `main-window-layout.tsx`:
- Replace `contentPanesService.hydrate()` with `paneLayoutService.hydrate()`
- Replace `<ContentPaneContainer />` with `<SplitLayoutContainer />` (if not already done in 02)

## Cmd+Click Detection

In click handlers that call navigation:

```typescript
const handleItemSelect = (itemId: string, type: string, event?: React.MouseEvent) => {
  const newTab = event?.metaKey; // Cmd on macOS
  navigationService.navigateToThread(itemId, { newTab });
};
```

This requires threading the mouse event through from `TreeMenu`'s `onItemSelect` callback up to the handler. Check the current `onItemSelect` signature and extend if needed.

Also support middle-click (`event.button === 1`) as new tab.

## Phases

- [x] Refactor `navigation-service.ts` to use `paneLayoutService` instead of `contentPanesService`
- [x] Add `newTab` option to all `navigateTo*` methods
- [x] Wire Cmd+Click and middle-click in sidebar to pass `newTab: true`
- [x] Add tree selection sync when active tab changes (via tab click, not just navigation)
- [x] Update `MainWindowLayout` hydration and component swap
- [x] Write integration tests for navigation flows (regular click dedup, Cmd+Click new tab)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
