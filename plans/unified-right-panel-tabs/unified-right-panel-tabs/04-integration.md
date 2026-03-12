# Track D: Integration

**Parent:** [unified-right-panel-tabs.md](../unified-right-panel-tabs.md)
**Parallel:** No — runs after Tracks A, B, and C are complete

## Goal

Wire everything together: swap the layout's conditional file-browser/search rendering for the unified `RightPanelContainer`, update the titlebar button to always-toggle, and update keyboard shortcuts.

## Phases

- [x] Update `MainWindowLayout` to render `RightPanelContainer` instead of conditional panels
- [x] Wire `PanelRight` button in titlebar to always-toggle
- [x] Update keyboard shortcuts (Cmd+Shift+F → open panel + Search tab)
- [x] Clean up dead imports and unused props

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Update `MainWindowLayout`

**File:** `src/components/main-window/main-window-layout.tsx`

### Replace right panel rendering (lines ~780-817)

Current: two conditional `<ResizablePanel>` blocks (one for file-browser, one for search).

New: single `<ResizablePanel>` that wraps `<RightPanelContainer>`, gated on `rightPanel.isOpen`.

```tsx
{rightPanel.isOpen && (
  <ResizablePanel
    position="right"
    minWidth={180}
    maxWidth={Math.floor(window.innerWidth * 0.5)}
    defaultWidth={250}
    persistKey="right-panel-width"
    closeThreshold={120}
    onClose={rightPanel.close}
    className="bg-surface-950"
  >
    <RightPanelContainer
      activeTab={rightPanel.activeTab}
      onTabChange={rightPanel.openTab}
      onClose={rightPanel.close}
      filesContext={activeWorktreeContext}
      filesWorktreeOverride={rightPanel.state.filesWorktreeOverride}
      onNavigateToFile={handleSearchNavigateToFile}
      onNavigateToThread={handleSearchNavigateToThread}
    />
  </ResizablePanel>
)}
```

### Add `useActiveWorktreeContext` call

```typescript
const activeWorktreeContext = useActiveWorktreeContext();
```

### Remove `lastRightPanelRef`

No longer needed — `useRightPanel` hook handles tab persistence internally.

### Update TreeMenu props

Remove `onOpenFiles` and `fileBrowserWorktreeId` props from `<TreeMenu>` (cleaned up by Track C). If we want a tree menu action to open Files tab for a specific worktree, wire it through as:

```tsx
<TreeMenu
  // ... existing props
  onOpenFiles={(repoId, worktreeId, path) => rightPanel.openFileBrowser(repoId, worktreeId, path)}
/>
```

**Decision:** Keep `onOpenFiles` on TreeMenu for now — it's a useful shortcut. Track C removes the `files` tree item, but the worktree context menu or section header could still trigger it.

## Phase 2: Wire titlebar button

**File:** `src/components/main-window/main-window-layout.tsx`

Update the `onToggleRightPanel` prop on `<WindowTitlebar>`:

```tsx
<WindowTitlebar
  leftPanelOpen={leftPanelOpen}
  rightPanelOpen={rightPanel.isOpen}
  onToggleLeftPanel={() => setLeftPanelOpen((v) => !v)}
  onToggleRightPanel={rightPanel.toggle}
/>
```

This replaces the current 12-line inline handler that tries to restore from `lastRightPanelRef`. The new `toggle()` from the refactored hook handles everything.

## Phase 3: Update keyboard shortcuts

**File:** `src/components/main-window/main-window-layout.tsx`

Update the Cmd+Shift+F handler (~line 121):

```typescript
// Current
rightPanel.openSearch();

// Same — openSearch() now opens panel + switches to search tab
rightPanel.openSearch();
```

No actual change needed here — `openSearch()` in the refactored hook already does the right thing (opens panel + sets activeTab to "search").

## Phase 4: Clean up dead imports

Remove from `main-window-layout.tsx`:
- `import { FileBrowserPanel }` (now rendered inside RightPanelContainer)
- `import { SearchPanel }` (now rendered inside RightPanelContainer)
- `lastRightPanelRef` and related logic
- Any unused `RightPanelState` type imports

Add:
- `import { RightPanelContainer }` from the new component
- `import { useActiveWorktreeContext }` (already imported in the file's hook)

## Files Changed

| File | Change |
| --- | --- |
| `src/components/main-window/main-window-layout.tsx` | Swap conditional panels for `RightPanelContainer`, simplify titlebar wiring, add worktree context |

## Verification Checklist

After integration, verify:
- [ ] PanelRight button toggles panel open/closed (never disabled, even on first click)
- [ ] Panel opens to Files tab by default
- [ ] Cmd+Shift+F opens panel on Search tab
- [ ] Clicking "Files" in tree menu opens panel on Files tab with that worktree
- [ ] Switching active content tab updates Files/Changelog worktree context
- [ ] Tab selection persists across close/open
- [ ] Panel width persists via `right-panel-width` key
- [ ] Closing panel via drag-resize works
- [ ] Clicking a commit in Changelog opens diff in main content pane
- [ ] "Changes" in tree menu is a flat leaf (no expand arrow)
- [ ] No "Files" item in tree menu
- [ ] No commit/uncommitted items under "Changes" in tree menu
