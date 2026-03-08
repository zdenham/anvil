# Fix: Quick Actions Context Filtering

## Problem

Quick actions like "archive" and "mark unread" show in the bottom gutter regardless of what content pane is focused. These actions only make sense in a thread context but appear when viewing terminals, PRs, files, etc.

## Root Cause

`QuickActionsPanel` (line 37-44) explicitly skips context filtering:

```ts
// Show all enabled actions (no context filtering in gutter)
const actions = useQuickActionsStore(
  useShallow((s) =>
    Object.values(s.actions)
      .filter((a) => a.enabled)
      .sort((a, b) => a.order - b.order)
  )
);
```

The infrastructure already exists:
- Actions declare `contexts: QuickActionContext[]` (`'thread' | 'plan' | 'empty' | 'all'`)
- `store.getForContext(context)` filters correctly
- `service.getForContext(context)` wraps it
- **Nobody calls it.**

## Mapping: ContentPaneView.type → QuickActionContext

| ContentPaneView type | QuickActionContext |
|---|---|
| `thread` | `'thread'` |
| `plan` | `'plan'` |
| `empty` | `'empty'` |
| `settings` | `'empty'` |
| `logs` | `'empty'` |
| `archive` | `'empty'` |
| `terminal` | `'empty'` |
| `file` | `'empty'` |
| `pull-request` | `'empty'` |
| `changes` | `'empty'` |

Only `thread` and `plan` have direct mappings. Everything else falls back to `'empty'` — actions marked `'all'` still show everywhere.

## Phases

- [x] Add context-aware filtering to `QuickActionsPanel`
- [x] Verify hotkey hook also respects context

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase Details

### 1. Add context-aware filtering to `QuickActionsPanel`

**`src/components/quick-actions/quick-actions-panel.tsx`:**

- Derive the current `QuickActionContext` from the active tab's `view.type` in the focused pane group
- Read from `usePaneLayoutStore` → `activeGroupId` → `groups[activeGroupId]` → active tab → `view.type`
- Map `view.type` to `QuickActionContext` using a simple helper:
  ```ts
  function viewTypeToActionContext(viewType: ContentPaneView['type']): QuickActionContext {
    if (viewType === 'thread') return 'thread';
    if (viewType === 'plan') return 'plan';
    return 'empty';
  }
  ```
- Replace the current unfiltered selector with one that uses `getForContext(context)` or inline the equivalent filter:
  ```ts
  const context = viewTypeToActionContext(activeViewType);
  const actions = useQuickActionsStore(
    useShallow((s) =>
      Object.values(s.actions)
        .filter((a) => a.enabled && (a.contexts.includes(context) || a.contexts.includes('all')))
        .sort((a, b) => a.order - b.order)
    )
  );
  ```

### 2. Verify hotkey hook respects context

**`src/hooks/use-quick-action-hotkeys.ts`:**

- Check whether `useQuickActionHotkeys` also fires actions without checking context
- If so, add the same context check before executing — a hotkey press for an action not valid in the current context should be a no-op

## Files Changed

| File | Change |
|------|--------|
| `src/components/quick-actions/quick-actions-panel.tsx` | Read active pane view type, filter actions by context |
| `src/hooks/use-quick-action-hotkeys.ts` | Possibly add context guard before execution |
