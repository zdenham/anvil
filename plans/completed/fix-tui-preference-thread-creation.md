# Fix: TUI preference should auto-route all thread creation

## Problem

When `preferTerminalInterface` is enabled, creating a new thread should automatically open a TUI thread. Instead:

1. **"+" dropdown** always shows both "New thread" and "New Claude session" as separate items — the preference is ignored
2. `handleNewThread` (`main-window-layout.tsx:393`) calls `threadService.create()` directly, bypassing the preference-aware `createThread()` router
3. **Cmd+N** already handles the preference correctly (line 258) — no change needed there

## Design

When `preferTerminalInterface` is true:

- "New thread" in the `+` dropdown and context menu should create a TUI thread (not a managed one)
- The override item flips: show "New managed thread" instead of "New Claude session"

When `preferTerminalInterface` is false (default):

- Current behavior: "New thread" = managed, "New Claude session" = TUI

This matches what the plan's Phase 6 describes under "Override menu items".

## Phases

- [x] Phase 1: Make `handleNewThread` preference-aware

- [x] Phase 2: Make `+` dropdown and context menu preference-aware

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Make `handleNewThread` preference-aware

### `src/components/main-window/main-window-layout.tsx`

`handleNewThread` (line 393): Currently calls `threadService.create()` directly. Change to check `preferTerminalInterface` and route to `createTuiThread()` when enabled — same pattern as the Cmd+N handler (line 258-264).

```typescript
const handleNewThread = useCallback(async (repoId: string, worktreeId: string, worktreePath: string) => {
  try {
    const preferTui = useSettingsStore.getState().workspace.preferTerminalInterface ?? false;

    if (preferTui) {
      const result = await createTuiThread({ repoId, worktreeId, worktreePath });
      await treeMenuService.hydrate();
      await navigationService.navigateToThread(result.threadId);
    } else {
      const thread = await threadService.create({
        repoId,
        worktreeId,
        prompt: "",
      });
      await treeMenuService.hydrate();
      await navigationService.navigateToThread(thread.id, { autoFocus: true });
    }
  } catch (err) {
    logger.error(`[MainWindowLayout] Failed to create thread:`, err);
  }
}, []);
```

Note: The callback signature changes — `_worktreePath` becomes `worktreePath` (was unused before but now needed for TUI thread creation).

Also ensure `handleNewClaudeSession` always force-creates a TUI thread (it already does — no change needed).

---

## Phase 2: Make `+` dropdown and context menu preference-aware

### `src/components/tree-menu/worktree-menus.tsx`

The `+` dropdown currently always shows both items unconditionally. Make the menu preference-aware:

**When** `preferTerminalInterface` **is true:**

- "New thread" item → calls `onNewThread` (which now creates TUI thanks to Phase 1)
- Show "New managed thread" override item → calls `onNewThread` with `forceManaged` behavior (need a new callback `onNewManagedThread`)

**When** `preferTerminalInterface` **is false:**

- "New thread" item → calls `onNewThread` (creates managed, as before)
- "New Claude session" item → calls `onNewClaudeSession` (creates TUI, as before)

**Approach**: Read `preferTerminalInterface` from the settings store inside the menu component. Swap which items are shown based on the preference. The "override" item uses the opposite callback.

Concretely in `PlusMenu`:

```tsx
const preferTui = useSettingsStore.getState().workspace.preferTerminalInterface ?? false;

// Primary action: "New thread" — always shown, calls onNewThread (preference-routed in Phase 1)
<PlusMenuItem icon={preferTui ? TerminalSquare : MessageSquarePlus} label={`New thread in ${item.worktreeName}`} ... />

// Override: show the opposite type
{preferTui
  ? <PlusMenuItem icon={MessageSquarePlus} label={`New managed thread in ${item.worktreeName}`} onClick={onNewManagedThread} />
  : <PlusMenuItem icon={TerminalSquare} label={`New Claude session in ${item.worktreeName}`} onClick={onNewClaudeSession} />
}
```

Same pattern for `WorktreeContextMenu`.

### Alternative (simpler): No new callback

Instead of adding `onNewManagedThread`, we can repurpose the existing callbacks:

- When `preferTui` is true: "New thread" calls `onNewClaudeSession`, override "New managed thread" calls `onNewThread` (which would need to force-managed)

But this gets confusing. **Cleaner approach**: keep `onNewThread` as preference-aware (Phase 1), and keep `onNewClaudeSession` as always-TUI. Then:

- When `preferTui` is false: show "New thread" (`onNewThread`) + "New Claude session" (`onNewClaudeSession`)
- When `preferTui` is true: show "New thread" (`onNewClaudeSession`, since it always creates TUI) + "New managed thread" (`onNewThread` but forced managed)

Wait — this still requires `onNewThread` to have a force-managed variant.

**Simplest approach**: Don't change callbacks at all. Just change which items are *visible* based on preference:

- When `preferTui` is true: hide "New Claude session" (redundant — "New thread" already creates TUI). Show "New managed thread" that calls a `forceManaged` handler.
- When `preferTui` is false: current behavior.

**Simplest viable approach** — just add a `forceManaged` callback:

### `main-window-layout.tsx`

Add `handleNewManagedThread` that always creates a managed thread regardless of preference:

```typescript
const handleNewManagedThread = useCallback(async (repoId: string, worktreeId: string, worktreePath: string) => {
  try {
    const thread = await threadService.create({ repoId, worktreeId, prompt: "" });
    await treeMenuService.hydrate();
    await navigationService.navigateToThread(thread.id, { autoFocus: true });
  } catch (err) {
    logger.error(`[MainWindowLayout] Failed to create managed thread:`, err);
  }
}, []);
```

### Props chain: `worktree-menus.tsx` → `worktree-item.tsx` → `tree-menu.tsx`

- Add `onNewManagedThread` prop alongside existing `onNewThread` / `onNewClaudeSession`
- Thread it through the component hierarchy

### Menu rendering (`worktree-menus.tsx`)

```tsx
// Inside PlusMenu — read preference
const preferTui = useSettingsStore((s) => s.workspace.preferTerminalInterface) ?? false;

// Primary "New thread" — always shown, preference-routed
<PlusMenuItem icon={preferTui ? TerminalSquare : MessageSquarePlus}
  label={`New thread in ${item.worktreeName}`} hint="dbl-click"
  show={!!(preferTui ? onNewClaudeSession : onNewThread)}
  onClick={() => { close(); (preferTui ? onNewClaudeSession : onNewThread)?.(repoId, worktreeId, worktreePath); }}
/>

// Override — show the non-default option
{preferTui
  ? <PlusMenuItem icon={MessageSquarePlus} label={`New managed thread in ${item.worktreeName}`}
      show={!!onNewManagedThread}
      onClick={() => { close(); onNewManagedThread?.(repoId, worktreeId, worktreePath); }}
    />
  : <PlusMenuItem icon={TerminalSquare} label={`New Claude session in ${item.worktreeName}`}
      show={!!onNewClaudeSession}
      onClick={() => { close(); onNewClaudeSession?.(repoId, worktreeId, worktreePath); }}
    />
}
```

### Double-click on "+" button

`handlePlusDoubleClick` calls `onNewThread`. When `preferTui` is true, it should call `onNewClaudeSession` instead:

```tsx
const handlePlusDoubleClick = (e: React.MouseEvent) => {
  e.stopPropagation();
  setShowMenu(false);
  const handler = preferTui ? onNewClaudeSession : onNewThread;
  handler?.(item.repoId!, item.worktreeId ?? item.id, item.worktreePath!);
};
```

### Files changed

| File | Change |
| --- | --- |
| `src/components/main-window/main-window-layout.tsx` | Make `handleNewThread` preference-aware; add `handleNewManagedThread`; pass new prop down |
| `src/components/tree-menu/worktree-menus.tsx` | Read preference; swap primary/override items; update double-click |
| `src/components/tree-menu/worktree-item.tsx` | Thread `onNewManagedThread` prop |
| `src/components/tree-menu/tree-menu.tsx` | Thread `onNewManagedThread` prop |
