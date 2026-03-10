# Terminal: Bottom Pane Default + Auto-Create on Worktree Creation

## Summary

Two related improvements to the terminal experience:

1. **Terminals default to bottom pane** — When opening a terminal (Cmd+T, menu click, or programmatic), it should open in a bottom split pane rather than replacing the current tab. Users can still drag terminals wherever they want.
2. **Auto-create terminal on worktree creation** — When a new worktree is created, automatically spawn a terminal session for it (opened in the bottom pane).

## Phases

- [ ] Add `openInBottomPane` helper to pane layout service

- [ ] Wire terminal creation to use bottom pane

- [ ] Auto-create terminal on worktree creation

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add `openInBottomPane` helper to pane layout service

The pane layout already supports vertical splits (`splitGroup` with `direction: "vertical"`). We need a helper that finds or creates a bottom pane group and opens a tab in it.

### Files to modify

`src/stores/pane-layout/service.ts` — Add `openInBottomPane(view: ContentPaneView)`:

```
async openInBottomPane(view: ContentPaneView): Promise<string>
```

Logic:

1. Look at the current root split tree. If the root is already a vertical split, the "bottom" group is the last child leaf. Check if it exists and reuse it.
2. If the root is a single leaf (no splits) or a horizontal split, split the active group vertically to create a bottom pane with \~35% height (65/35 split).
3. Open the tab in the bottom group.
4. Set the bottom group as the active group.

Specifically:

- If `root.type === "split" && root.direction === "vertical"`, find the last child leaf's groupId — that's the bottom group. Open the tab there via `openTab(view, bottomGroupId)`.
- Otherwise, call `splitGroup(activeGroupId, "vertical", view)` which creates a new group below with the terminal view. Then adjust sizes to 65/35 via `updateSplitSizes`.

`src/stores/pane-layout/split-tree.ts` — No changes needed. The existing `splitLeafNode` puts the new group as the second child which is correct for "below".

### Size preference

Use 65/35 (main content on top, terminal on bottom) as the default split ratio. This matches VS Code / other IDE conventions.

## Phase 2: Wire terminal creation to use bottom pane

### Files to modify

`src/stores/navigation-service.ts` — Add an option to `NavigateOptions`:

```ts
export interface NavigateOptions {
  newTab?: boolean;
  autoFocus?: boolean;
  /** Open in a bottom split pane (used for terminals) */
  bottomPane?: boolean;
}
```

Update `openOrFind` to handle `bottomPane`:

```ts
function openOrFind(view: ContentPaneView, options?: NavigateOptions): Promise<void> {
  if (options?.bottomPane) {
    return paneLayoutService.openInBottomPane(view).then(() => undefined);
  }
  if (options?.newTab) {
    return paneLayoutService.openTab(view).then(() => undefined);
  }
  return paneLayoutService.findOrOpenTab(view);
}
```

`src/components/main-window/main-window-layout.tsx` — Update `handleNewTerminal` to pass `bottomPane: true`:

```ts
const handleNewTerminal = useCallback(async (worktreeId: string, worktreePath: string) => {
  try {
    const session = await terminalSessionService.create(worktreeId, worktreePath);
    await navigationService.navigateToTerminal(session.id, { bottomPane: true });
  } catch (err) {
    logger.error(`[MainWindowLayout] Failed to create terminal:`, err);
  }
}, []);
```

This affects both:

- The tree menu "New terminal" button → calls `handleNewTerminal` → uses `bottomPane`
- Cmd+T keyboard shortcut → calls `handleNewTerminal` → uses `bottomPane`

`src/stores/navigation-service.ts` — Update `navigateToTerminal` to pass through `bottomPane`:

The existing `navigateToTerminal` calls `openOrFind(view, options)`, so `bottomPane` will flow through automatically since we're updating `NavigateOptions` and `openOrFind`.

### Behavior when bottom pane already exists

If a vertical split already exists and the bottom group has a terminal tab, `openInBottomPane` should open a **new tab** in that bottom group (not replace the existing one). This way multiple terminals stack as tabs in the bottom pane.

If the user has already navigated to a terminal (clicking it in the sidebar), the existing `findOrOpenTab` logic in `navigateToTerminal` handles finding the existing tab. The `bottomPane` option is only for **creating new** terminals (where we want to force bottom placement).

Note: `navigateToTerminal` should only use `bottomPane` when creating a new terminal. When clicking an existing terminal in the sidebar, the default `findOrOpenTab` behavior should be used (finds the existing tab wherever it is). So `bottomPane` should only be passed by `handleNewTerminal`, not by `handleItemSelect`.

## Phase 3: Auto-create terminal on worktree creation

### Files to modify

`src/components/main-window/main-window-layout.tsx` — In `handleNewWorktree`, after the worktree is successfully created and hydrated, spawn a terminal:

After the existing worktree creation success path (around line 476 after `treeMenuService.hydrate()`), add:

```ts
// Auto-create a terminal for the new worktree
try {
  const syncedWorktrees = await worktreeService.sync(repoName);
  const newWorktree = syncedWorktrees.find(w => w.name === worktreeName);
  if (newWorktree) {
    const session = await terminalSessionService.create(newWorktree.id, newWorktree.path);
    await navigationService.navigateToTerminal(session.id, { bottomPane: true });
  }
} catch (termErr) {
  logger.warn(`[MainWindowLayout] Failed to auto-create terminal for worktree (non-fatal):`, termErr);
}
```

Note: The `syncedWorktrees` fetch already happens for the setup prompt logic. We can share that result — move the `worktreeService.sync(repoName)` call up to be shared between the setup prompt logic and the terminal creation logic.

### Order of operations

After worktree creation succeeds:

1. Hydrate stores (already exists)
2. Auto-create terminal in bottom pane (new)
3. Auto-run setup thread if configured (already exists)

The terminal creation should happen before the setup thread so the user sees the terminal pane immediately. The setup thread will open in the main pane area.

## Edge Cases

- **Already have a bottom terminal pane**: New terminal opens as a new tab in the existing bottom group — handled by `openInBottomPane` opening in the existing bottom group.
- **User has rearranged layout**: If the root is a complex nested split, `openInBottomPane` should still work — it checks if the root is a vertical split and uses the last child. If not, it splits the active group vertically.
- **Single empty pane**: If the only pane shows "empty", splitting vertically is still correct — the empty pane stays on top, terminal goes to bottom.