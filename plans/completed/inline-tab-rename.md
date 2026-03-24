# Inline Tab Rename in Tab Header

## Summary

Add double-click-to-rename support directly in the tab bar header, matching the existing sidebar rename UX. Currently, tabs can only be renamed from the left sidebar's tree menu (double-click or context menu → Rename). This plan adds the same capability inline on the tab itself.

## Key Observations

- **Single source of truth — renaming updates both tab and sidebar automatically.** Tab names (`useTabLabel`) and sidebar names (`threadToNode`, `terminalToNode`) both read from the same Zustand entity stores (`useThreadStore`, `useTerminalSessionStore`). The rename callbacks write to these stores via `threadService.update()` / `terminalSessionService.setLabel()`, which means a rename from the tab bar immediately reflects in the sidebar (and vice versa) with zero extra sync logic.
- **Only threads and terminals support user-assigned names** — plans, files, PRs, settings derive names from metadata and shouldn't be renameable
- `useInlineRename` **hook exists** but is coupled to `treeMenuService.stopRename()` — needs a version decoupled from the tree menu
- **Drag-and-drop must be disabled while renaming** — otherwise clicking the input would initiate a drag

## Phases

- [x] Create `useTabInlineRename` hook decoupled from tree menu

- [x] Add rename support to `TabItem` component

- [x] Add context menu with Rename option to tab items

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Create `useTabInlineRename` hook

**File:** `src/components/split-layout/use-tab-inline-rename.ts`

Extract a tab-specific inline rename hook based on the existing `useInlineRename` pattern but without the `treeMenuService` dependency:

- Same state management: `isRenaming`, `renameValue`, `inputRef`, `isSubmittingRef`
- Same keyboard handling: Enter → submit, Escape → cancel
- Same blur-to-submit behavior
- **Remove** `treeMenuService.stopRename()` calls (not relevant to tab bar)
- **Remove** space-to-hyphen replacement (thread names can have spaces — the sidebar hook replaces spaces with hyphens which feels like a bug/worktree-specific behavior; tab rename should preserve input as-is)
- Accept `currentName` and `onRename` callback, same interface

Alternatively, refactor the existing `useInlineRename` to make the `treeMenuService` calls optional (e.g., pass an optional `onComplete` callback instead of hardcoding `treeMenuService.stopRename()`). This avoids code duplication. Decision: prefer the refactor approach — add an optional `onFinish` callback that defaults to `treeMenuService.stopRename()` for backward compatibility.

## Phase 2: Add rename support to `TabItem`

**File:** `src/components/split-layout/tab-item.tsx`

### Determine if tab is renameable

Add a helper function `isRenameable(view: ContentPaneView): boolean` that returns `true` only for `thread` and `terminal` view types.

### Wire up rename hook

- Call the rename hook with the appropriate `onRename` callback based on view type:
  - **Thread:** `threadService.update(threadId, { name: newName })` — writes to `useThreadStore`, which both `useTabLabel` and sidebar's `threadToNode()` subscribe to
  - **Terminal:** `terminalSessionService.setLabel(terminalId, newName)` — writes to `useTerminalSessionStore` (sets `{ label, isUserLabel: true }`), which both `useTabLabel` and sidebar's `terminalToNode()` subscribe to
- These are the **same service calls** the sidebar's `useInlineRename` already uses — the tab rename just provides an additional entry point to the same underlying store mutation
- Pass `currentName` from the existing `useTabLabel` result

### Double-click trigger

- Add `onDoubleClick` handler on the label `<span>` that calls `startRename()` (only for renameable tabs)
- When `isRenaming` is true, render an `<input>` instead of the label `<span>`

### Input styling

- Match the tab's existing text style (text-xs font-medium)
- Transparent background with subtle bottom border (same as sidebar pattern)
- `min-width` to prevent the tab from collapsing
- `max-width` matching the tab's `max-w-[200px]` constraint
- Click on input must `stopPropagation` to prevent tab activation

### Drag-and-drop interaction

- When `isRenaming` is true, disable the sortable drag by either:
  - Not spreading `...listeners` on the button, or
  - Setting `disabled: true` on the `useSortable` config
- This prevents drag initiation when clicking into the rename input

## Phase 3: Add context menu with Rename option

**File:** `src/components/split-layout/tab-item.tsx`

Add a right-click context menu to tab items (for renameable tabs only) with a "Rename" option, matching the sidebar pattern:

- Use the existing `useContextMenu` hook and `ContextMenu`/`ContextMenuItem` components
- Include "Rename" and "Close" as menu items
- "Rename" triggers `startRename()`
- "Close" triggers the existing close logic
- Only show "Rename" for renameable tab types

## Data Flow (for clarity)

```
Tab double-click / context menu "Rename"
  → onRename(newName)
    → threadService.update(id, { name }) / terminalSessionService.setLabel(id, label)
      → Zustand store mutation (useThreadStore / useTerminalSessionStore)
        → useTabLabel re-renders tab with new name  ✓
        → threadToNode / terminalToNode re-renders sidebar with new name  ✓
        → Persisted to ~/.anvil/{entity}/{id}/metadata.json  ✓
```

No explicit sync needed — both UI surfaces subscribe to the same store.

## Out of Scope

- Renaming plans, files, PRs, or other non-user-named tab types
- Explicit sync between sidebar and tab header (unnecessary — both read from same store)
- F2 keyboard shortcut on tabs (could be added later but requires focus management)