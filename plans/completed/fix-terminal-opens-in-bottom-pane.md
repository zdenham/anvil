# Fix: Terminal Sidebar Click Should Open in Bottom Pane

## Problem

Clicking a terminal in the sidebar **replaces the current thread** instead of opening in a bottom split pane. This happens because `handleItemSelect` in `main-window-layout.tsx:335` calls:

```ts
await navigationService.navigateToTerminal(itemId, { newTab });
```

This does **not** pass `bottomPane: true`, so `openOrFind` falls through to `findOrOpenTab`, which either finds an existing tab or replaces the active tab view — putting the terminal where the thread was.

By contrast, **creating** a new terminal (Cmd+T, new worktree auto-terminal) correctly passes `{ bottomPane: true }` (lines 383, 493).

## Root Cause

Two issues:

1. **`handleItemSelect` doesn't pass `bottomPane: true` for terminals** — the sidebar click path is missing the option.

2. **`openOrFind` skips dedup when `bottomPane` is set** — if the terminal tab already exists (e.g., in the bottom pane), `openInBottomPane` doesn't check for it and would create a duplicate.

## Phases

- [x] Pass `bottomPane: true` when clicking terminals in sidebar
- [x] Add find-first logic to `openInBottomPane` to avoid duplicate tabs

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Pass `bottomPane: true` for Terminal Sidebar Clicks

**File**: `src/components/main-window/main-window-layout.tsx` (~line 335)

Change the terminal branch of `handleItemSelect` from:

```ts
await navigationService.navigateToTerminal(itemId, { newTab });
```

To:

```ts
await navigationService.navigateToTerminal(itemId, { bottomPane: true });
```

This aligns the sidebar-click behavior with the Cmd+T and new-worktree paths. The `newTab` modifier (Cmd+click) is intentionally dropped for terminals — terminals should always target the bottom pane rather than opening as a main-area tab.

## Phase 2: Deduplicate in `openInBottomPane`

**File**: `src/stores/pane-layout/service.ts` (~line 206)

Currently `openInBottomPane` always opens a new tab without checking if one already exists. This means clicking an already-open terminal in the sidebar would create a duplicate tab in the bottom pane.

Add a find-first check at the top of `openInBottomPane`:

```ts
async openInBottomPane(view: ContentPaneView): Promise<string> {
  // First check if a matching tab already exists in any group — just activate it
  const { groups } = usePaneLayoutStore.getState();
  for (const group of Object.values(groups)) {
    const match = group.tabs.find((t) => viewsMatch(t.view, view));
    if (match) {
      usePaneLayoutStore.getState()._applySetActiveGroup(group.id);
      usePaneLayoutStore.getState()._applySetActiveTab(group.id, match.id);
      await persistState();
      return match.id;
    }
  }

  // ... existing split/open logic unchanged ...
}
```

**Note**: `viewsMatch` is currently a module-level function in `navigation-service.ts`. It needs to either be:
- Moved to a shared location (e.g., `pane-layout/utils.ts` or exported from `content-pane/types.ts`)
- Or duplicated in `pane-layout/service.ts` (less ideal but keeps the change small)

Recommendation: extract `viewsMatch` to `src/stores/pane-layout/utils.ts` and import from both files. It's closely related to pane layout concerns anyway.
