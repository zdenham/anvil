# Phase 5: Deprecation & Cleanup

## Overview

This phase removes deprecated components and cleans up the codebase after the new tree menu and content pane architecture is fully operational. This is the final cleanup phase and should ONLY execute after Phase 6 (regression testing) confirms the new architecture works correctly.

**CRITICAL GATE:** Do NOT proceed with this phase until manual testing confirms:
- [ ] Thread views work in new content panes
- [ ] Plan views work in new content panes
- [ ] NSPanel still works independently
- [ ] Spotlight -> thread opening works
- [ ] Settings and Logs accessible from new header icons

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Phase 4 (Layout Assembly) | Required | New layout must be complete and working |
| Phase 6 (Regression Testing) | Required | Must pass before any deletions |

**Parallelization:** This phase CANNOT run in parallel with other phases. It is strictly sequential and destructive.

---

## Pre-Flight Checks

Before executing ANY step in this phase, run these verification checks:

### 1. Phase 4 Artifacts Exist

Verify required files from Phase 4 exist:

```bash
# Required stores
ls -la src/stores/content-panes-store.ts
ls -la src/stores/layout-store.ts

# Required components
ls -la src/components/tree-menu/tree-panel-header.tsx
ls -la src/components/content-pane/content-pane-container.tsx

# Tree menu components from Phase 3
ls -la src/components/tree-menu/tree-menu.tsx
```

### 2. Required Exports Available

Verify the exports from Phase 4 are available:

```typescript
// Test in a scratch file or console:
import { useContentPanesStore, useActivePaneView } from "@/stores/content-panes-store";
import { useLayoutStore } from "@/stores/layout-store";

// Verify setActivePaneView exists (convenience method)
const { setActivePaneView } = useContentPanesStore.getState();
```

### 3. TypeScript Passes

```bash
pnpm typecheck
```

If typecheck fails, do NOT proceed. Fix type errors first.

### 4. Phase 6 Regression Tests Pass

All mandatory tests in Phase 6 checklist must have "Pass" marked.

---

## Files to Delete

### Mission Control Components

| File | Path | Notes |
|------|------|-------|
| Unified Inbox | `src/components/inbox/unified-inbox.tsx` | Main Mission Control view |
| Inbox Item | `src/components/inbox/inbox-item.tsx` | Individual row component |
| Inbox Header | `src/components/inbox/inbox-header.tsx` | Search bar and refresh |
| Search Input | `src/components/inbox/search-input.tsx` | Search component (only used by inbox) |
| Empty State | `src/components/inbox/empty-inbox-state.tsx` | Empty inbox UI |
| Archive Button | `src/components/inbox/archive-button.tsx` | Archive action component |
| **Tests** | | |
| Unified Inbox Test | `src/components/inbox/__tests__/unified-inbox.test.tsx` | |
| Inbox Item Test | `src/components/inbox/__tests__/inbox-item.test.tsx` | |
| Archive Button Test | `src/components/inbox/__tests__/archive-button.test.tsx` | |
| Empty State Test | `src/components/inbox/__tests__/empty-inbox-state.test.tsx` | |
| Utils Test | `src/components/inbox/__tests__/utils.test.ts` | |

**KEEP:** `src/components/inbox/utils.ts` - Contains `createUnifiedList` used by `InboxListWindow.tsx`.

**DELETE AFTER RELOCATION:** `src/components/inbox/types.ts` - Contains `InboxItem` type which must be relocated first (see Step 0).

### Workflows Page

| File | Path | Notes |
|------|------|-------|
| Worktrees Page | `src/components/main-window/worktrees-page.tsx` | Full Worktrees tab page |

**KEEP:** Worktree data fetching logic lives in `src/entities/worktrees/` - needed for tree menu.

### Old Sidebar

| File | Path | Notes |
|------|------|-------|
| Sidebar | `src/components/main-window/sidebar.tsx` | Old navigation sidebar |

---

## Component Sharing Clarification

### control-panel-window.tsx Status: KEEP

The `src/components/control-panel/control-panel-window.tsx` component is **NOT** deprecated. It serves the NSPanel floating window which remains a critical part of the architecture.

**Relationship to content pane:**
- `control-panel-window.tsx` - Renders thread/plan views in the NSPanel (floating window)
- `content-pane-container.tsx` (Phase 4) - Renders thread/plan views in the main window's content pane

Both components share the same underlying view components (`ThreadView`, `PlanView`) but have different wrapping/chrome:
- NSPanel has drag handle, floating behavior, suggested actions panel
- Content pane has simpler chrome, integrated with tree menu

**Do NOT delete:**
- `src/components/control-panel/control-panel-window.tsx`
- `src/components/control-panel/` directory (contains active components)

---

## Files to Update

### 1. Relocate InboxItem Type (Step 0)

**Current Location:** `src/components/inbox/types.ts`
**New Location:** `src/types/navigation.ts` (create new file)

The `InboxItem` type is used by:
- `src/components/inbox/utils.ts` (createUnifiedList returns InboxItem[])
- `src/hooks/use-unified-inbox-navigation.ts`
- `src/hooks/use-navigate-to-next-item.ts`
- `src/components/inbox-list/InboxListWindow.tsx` (via utils)

**New file: `src/types/navigation.ts`**
```typescript
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";

/**
 * Union type for unified list items.
 * Items are interleaved in navigation lists based on updatedAt.
 */
export type InboxItem =
  | { type: "thread"; data: ThreadMetadata; sortKey: number; displayText: string }
  | { type: "plan"; data: PlanMetadata; sortKey: number; displayText: string };
```

**Update imports in:**
- `src/components/inbox/utils.ts` - Change to `import type { InboxItem } from "@/types/navigation";`
- `src/hooks/use-unified-inbox-navigation.ts` - Change to `import type { InboxItem } from "@/types/navigation";`
- `src/hooks/use-navigate-to-next-item.ts` - If it imports InboxItem, update similarly
- `src/components/inbox/index.ts` - Re-export from new location: `export type { InboxItem } from "@/types/navigation";`

### 2. Redirect getPlanDisplayName Imports

The `getPlanDisplayName` function exists in TWO locations:
- `src/components/inbox/utils.ts` (will be kept but function should be removed)
- `src/entities/plans/utils.ts` (canonical location - KEEP)

**Before deleting inbox utils tests**, redirect any imports from `@/components/inbox/utils` to `@/entities/plans/utils`:

```typescript
// BEFORE (in inbox/utils.ts)
export function getPlanDisplayName(plan: PlanMetadata): string { ... }

// AFTER - Remove from inbox/utils.ts, import from canonical location
import { getPlanDisplayName } from "@/entities/plans/utils";
```

**Update `src/components/inbox/utils.ts`:**
```typescript
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { InboxItem } from "@/types/navigation";
import { getPlanDisplayName } from "@/entities/plans/utils"; // Import instead of define

// Remove the local getPlanDisplayName function definition
// Keep only createUnifiedList which uses the imported function
```

**Update `src/components/inbox/index.ts`:**
```typescript
// Re-export from canonical location
export { getPlanDisplayName } from "@/entities/plans/utils";
export { createUnifiedList } from "./utils";
export type { InboxItem } from "@/types/navigation";
```

### 3. Define closeAndShowInbox() Replacement

**Current behavior:** `closeAndShowInbox()` in `src/lib/panel-navigation.ts` calls `open_inbox_list_panel` (Rust command) which shows the floating inbox list panel.

**New behavior:** In the content pane architecture, when there are no more unread items after archive, the content pane should show the empty state.

**Update `src/lib/panel-navigation.ts`:**

```typescript
// BEFORE
export async function closeAndShowInbox(): Promise<void> {
  // Close control panel and show inbox list panel
  await invoke("close_control_panel");
  await invoke("open_inbox_list_panel");
}

// AFTER
export async function closeAndShowInbox(): Promise<void> {
  const currentWindow = getCurrentWindow();
  const windowLabel = currentWindow.label;

  if (windowLabel === "control-panel") {
    // NSPanel: close and show the inbox list panel (unchanged behavior)
    await invoke("close_control_panel");
    await invoke("open_inbox_list_panel");
  } else if (windowLabel === "main") {
    // Main window: clear content pane to empty state
    // Import at top: import { useContentPanesStore } from "@/stores/content-panes-store";
    useContentPanesStore.getState().setActivePaneView({ type: "empty" });
  } else {
    // Standalone window: just close the window
    await currentWindow.close();
  }
}
```

**Alternative (simpler):** If the InboxListWindow is kept for keyboard navigation (Alt+Up/Down), then `closeAndShowInbox()` can remain unchanged. The inbox list panel is a separate UI from Mission Control.

**Decision:** The `InboxListWindow` component in `src/components/inbox-list/InboxListWindow.tsx` is **KEPT** because it serves the Alt+Up/Down keyboard navigation flow, which is separate from the deprecated Mission Control view. Therefore, `closeAndShowInbox()` behavior remains unchanged for NSPanel contexts.

### 4. Fix Menu Item References

**Actual menu items in `src-tauri/src/menu.rs`:**
- `nav_tasks` (not `nav_inbox`)
- `nav_worktrees`
- `nav_settings`
- `nav_logs`

**Actions:**
1. **Remove `nav_tasks`** - This mapped to the old "Tasks" tab (Mission Control). Remove from menu.
2. **Remove `nav_worktrees`** - Worktrees tab is deprecated. Remove from menu.
3. **Keep `nav_settings`** - Maps to settings view in content pane.
4. **Keep `nav_logs`** - Maps to logs view in content pane.

**Update `src-tauri/src/menu.rs`:**
```rust
// REMOVE these lines:
// &MenuItemBuilder::with_id("nav_tasks", "Tasks")
//     .accelerator("Cmd+1")
//     .build(app)?,
// &MenuItemBuilder::with_id("nav_worktrees", "Worktrees")
//     .accelerator("Cmd+2")
//     .build(app)?,

// KEEP these (renumber accelerators):
&MenuItemBuilder::with_id("nav_settings", "Settings")
    .accelerator("Cmd+,")  // Standard settings shortcut
    .build(app)?,
&MenuItemBuilder::with_id("nav_logs", "Logs")
    .accelerator("Cmd+Shift+L")  // Or remove accelerator
    .build(app)?,
```

### 5. Update Navigation Event Handler

**File:** `src/components/main-window/main-window-layout.tsx`

Use `setActivePaneView()` convenience method (from Phase 4) instead of manually tracking `activePaneId`:

```typescript
useEffect(() => {
  const unlisten = listen<string>("navigate", (event) => {
    const target = event.payload;

    switch (target) {
      case "settings":
        useContentPanesStore.getState().setActivePaneView({ type: "settings" });
        break;
      case "logs":
        useContentPanesStore.getState().setActivePaneView({ type: "logs" });
        break;
      case "tasks":
      case "worktrees":
        // Deprecated navigation targets - no-op with warning
        console.warn(`[MainWindowLayout] Deprecated navigation target: ${target}`);
        break;
      default:
        console.warn(`[MainWindowLayout] Unknown navigation target: ${target}`);
    }
  });
  return () => { unlisten.then((fn) => fn()); };
}, []);
```

### 6. Update TabId Type Definition

**File:** `src/components/main-window/main-window-layout.tsx`

**Current:**
```typescript
export type TabId = "inbox" | "worktrees" | "logs" | "settings";

const VALID_TABS: TabId[] = ["inbox", "worktrees", "logs", "settings"];
```

**After:**
```typescript
// Remove TabId entirely - no longer needed
// Navigation now handled by content pane views
```

---

## Step-by-Step Execution Order

Execute in this exact order to avoid broken imports during the process.

### Step 0: Relocate Types and Redirect Imports

Before deleting anything:

- [ ] Create `src/types/navigation.ts` with `InboxItem` type
- [ ] Update `src/components/inbox/utils.ts` to import `InboxItem` from new location
- [ ] Update `src/components/inbox/utils.ts` to import `getPlanDisplayName` from `@/entities/plans/utils`
- [ ] Remove local `getPlanDisplayName` definition from `src/components/inbox/utils.ts`
- [ ] Update `src/hooks/use-unified-inbox-navigation.ts` to import `InboxItem` from `@/types/navigation`
- [ ] Update `src/components/inbox/index.ts` to re-export from new locations
- [ ] Run `pnpm typecheck` - must pass before continuing

### Step 1: Update Main Window Layout

- [ ] Remove `Sidebar` import and usage
- [ ] Remove `WorktreesPage` import and usage
- [ ] Remove `UnifiedInbox` and `InboxHeader` imports and usage
- [ ] Remove `TabId` type and `VALID_TABS` constant
- [ ] Remove `activeTab` state
- [ ] Remove search-related state and memos
- [ ] Remove `handleRefresh`, `handleThreadSelect`, `handlePlanSelect`
- [ ] Update navigation event handler to use `setActivePaneView()`

**Verification:** `pnpm typecheck` passes

### Step 2: Delete Old Sidebar

- [ ] Delete `src/components/main-window/sidebar.tsx`

**Verification:** `pnpm typecheck` passes

### Step 3: Delete Worktrees Page

- [ ] Delete `src/components/main-window/worktrees-page.tsx`

**Verification:** `pnpm typecheck` passes

### Step 4: Delete Inbox Components (Order Matters)

Delete in this order:

1. [ ] Delete `src/components/inbox/__tests__/unified-inbox.test.tsx`
2. [ ] Delete `src/components/inbox/__tests__/inbox-item.test.tsx`
3. [ ] Delete `src/components/inbox/__tests__/archive-button.test.tsx`
4. [ ] Delete `src/components/inbox/__tests__/empty-inbox-state.test.tsx`
5. [ ] Delete `src/components/inbox/__tests__/utils.test.ts`
6. [ ] Delete `src/components/inbox/unified-inbox.tsx`
7. [ ] Delete `src/components/inbox/inbox-header.tsx`
8. [ ] Delete `src/components/inbox/inbox-item.tsx`
9. [ ] Delete `src/components/inbox/search-input.tsx`
10. [ ] Delete `src/components/inbox/empty-inbox-state.tsx`
11. [ ] Delete `src/components/inbox/archive-button.tsx`
12. [ ] Delete `src/components/inbox/types.ts` (InboxItem already relocated)
13. [ ] Update `src/components/inbox/index.ts` to only export:
    - `createUnifiedList` from `./utils`
    - `getPlanDisplayName` from `@/entities/plans/utils`
    - `InboxItem` type from `@/types/navigation`

**Verification:** `pnpm typecheck` passes

### Step 5: Clean Up Hook Exports

Check usage before deleting:

- [ ] Search for `useUnifiedInboxNavigation` - used by control panel navigation (KEEP)
- [ ] Search for `useNavigateToNextItem` - used by control panel navigation (KEEP)

These hooks are still needed for NSPanel's keyboard navigation. Do NOT delete.

### Step 6: Update macOS Menu Items

- [ ] Remove `nav_tasks` menu item from `src-tauri/src/menu.rs`
- [ ] Remove `nav_worktrees` menu item from `src-tauri/src/menu.rs`
- [ ] Update accelerator keys for remaining items
- [ ] Rebuild Rust code

**Verification:** `cargo build` passes, menu works correctly

### Step 7: Final Cleanup

- [ ] Run `pnpm typecheck` to verify no type errors
- [ ] Run `pnpm lint` to check for unused imports
- [ ] Search codebase for any remaining references to deleted files
- [ ] Remove the `src/components/inbox/__tests__/` directory if empty
- [ ] Keep `src/components/inbox/` directory (contains `utils.ts` and `index.ts`)

---

## InboxListWindow.tsx Status

**Decision: KEEP**

The `src/components/inbox-list/InboxListWindow.tsx` component is **NOT** part of this deprecation. It serves the Alt+Up/Down keyboard navigation flow:

1. User holds Alt and presses Down - shows floating inbox list panel
2. User navigates with Alt+Down/Up through items
3. User releases Alt - opens selected item in control panel

This is separate from the deprecated Mission Control view which was a tab in the main window sidebar.

**InboxListWindow.tsx dependencies to preserve:**
- `createUnifiedList` from `@/components/inbox/utils` - KEPT
- `InboxItemRow` from `@/components/inbox/inbox-item` - This import will break!

**Additional Step Required:**

The `InboxListWindow.tsx` imports `InboxItemRow` from the inbox-item component being deleted. Options:

1. **Extract InboxItemRow** to a shared location before deleting inbox-item.tsx
2. **Create simplified row component** in InboxListWindow.tsx
3. **Keep inbox-item.tsx** but rename to clarify it's for navigation, not Mission Control

**Recommended:** Extract `InboxItemRow` to `src/components/inbox-list/inbox-item-row.tsx` before Step 4.

Add to Step 0:
- [ ] Copy `InboxItemRow` component from `src/components/inbox/inbox-item.tsx` to `src/components/inbox-list/inbox-item-row.tsx`
- [ ] Update `InboxListWindow.tsx` to import from local file
- [ ] Simplify if needed (InboxListWindow only needs basic row rendering)

---

## Post-Deletion Verification Checklist

After completing all deletions, verify:

### Build & Types
- [ ] `pnpm typecheck` passes with no errors
- [ ] `pnpm build` completes successfully
- [ ] `cargo build` completes successfully (Rust menu changes)
- [ ] No console errors on app startup

### Navigation
- [ ] Tray menu "Settings..." opens settings in content pane
- [ ] macOS menu View > Settings works
- [ ] macOS menu View > Logs works
- [ ] No menu items for deprecated "Tasks" or "Worktrees"

### Functionality
- [ ] Tree menu displays correctly
- [ ] Clicking tree items opens content
- [ ] Settings accessible from header icon
- [ ] Logs accessible from header icon
- [ ] NSPanel still works (Shift+Enter from spotlight)
- [ ] Spotlight search still works
- [ ] Alt+Down/Up navigation still works (InboxListWindow)
- [ ] Archive -> next item flow works in NSPanel

### Code Quality
- [ ] No orphaned imports
- [ ] No unused variables
- [ ] No TypeScript errors
- [ ] Git status shows only expected deletions

---

## Acceptance Criteria

This phase is complete when:

1. **All deprecated files deleted:**
   - `src/components/inbox/unified-inbox.tsx` - DELETED
   - `src/components/inbox/inbox-item.tsx` - DELETED (after extracting InboxItemRow)
   - `src/components/inbox/inbox-header.tsx` - DELETED
   - `src/components/main-window/worktrees-page.tsx` - DELETED
   - `src/components/main-window/sidebar.tsx` - DELETED

2. **Type system clean:**
   - `TabId` type removed
   - `InboxItem` type relocated to `src/types/navigation.ts`
   - No references to "inbox" or "worktrees" as navigation targets
   - `pnpm typecheck` passes

3. **Build clean:**
   - `pnpm build` succeeds
   - `cargo build` succeeds
   - No unused import warnings
   - No dead code

4. **Navigation updated:**
   - "navigate" event handler uses `setActivePaneView()`
   - Deprecated targets logged but don't crash
   - Settings/Logs navigation works
   - Menu items updated

5. **No regressions:**
   - All Phase 6 regression tests still pass
   - NSPanel functions correctly
   - InboxListWindow functions correctly
   - Spotlight -> thread flow works

---

## Rollback Plan

If issues are discovered after deletion:

1. **Git revert:** All deletions should be in a single commit for easy revert
2. **Branch strategy:** Work on a feature branch, merge only after verification
3. **Staged deletion:** If nervous, delete one component group at a time with verification between each

**Recommended commit message:**
```
feat(ui): remove deprecated Mission Control and Workflows

- Delete unified inbox components (unified-inbox, inbox-item, inbox-header)
- Delete worktrees page
- Delete old sidebar
- Relocate InboxItem type to src/types/navigation.ts
- Redirect getPlanDisplayName imports to canonical location
- Update navigation event handlers for content pane architecture
- Remove TabId type and tab-based routing
- Update macOS menu (remove nav_tasks, nav_worktrees)

BREAKING CHANGE: Mission Control view and Workflows page removed.
Navigation now uses tree menu and content pane system.
```

---

## Notes

### Files to Keep

| File | Reason |
|------|--------|
| `src/components/inbox/utils.ts` | `createUnifiedList` used by `InboxListWindow.tsx` |
| `src/components/inbox/index.ts` | Re-exports for external consumers |
| `src/components/inbox-list/InboxListWindow.tsx` | Alt+Down/Up navigation panel |
| `src/components/control-panel/control-panel-window.tsx` | NSPanel floating window |
| `src/hooks/use-unified-inbox-navigation.ts` | NSPanel keyboard navigation |
| `src/hooks/use-navigate-to-next-item.ts` | Archive -> next item flow |
| `src/lib/panel-navigation.ts` | `closeAndShowInbox()` for NSPanel |

### Downstream Impacts

Components that reference deleted files (must update imports):
- `src/components/inbox-list/InboxListWindow.tsx` - Update to use extracted `InboxItemRow`
- `src/components/main-window/main-window-layout.tsx` - Remove deleted imports

### Future Cleanup (Out of Scope)

These items are related but not part of this phase:
- Consolidate navigation logic into tree menu
- Remove remaining inbox-related stores/state if unused
- Rename `InboxListWindow` to `NavigationListWindow` for clarity
