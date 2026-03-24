# Trim Default Quick Actions & Add Mark Unread to Context Menus

Remove mark unread, close, and archive from the default quick actions. Keep "Next Unread" as the only default. Add "Mark Unread" as a context menu item on plan and thread tree items.

## Context

Currently 4 default quick actions ship in `core/sdk/template/src/actions/`:
- `mark-unread.ts` — contexts: thread, plan
- `close-panel.ts` — contexts: thread, plan
- `archive.ts` — contexts: thread, plan
- `next-unread.ts` — contexts: empty

Archive and close are already accessible via the tree menu (hover archive button, panel close). Mark unread needs to move to the right-click context menu instead.

## Phases

- [x] Remove default quick action files and update next-unread
- [x] Add "Mark Unread" to thread and plan context menus

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Remove default quick action files and update next-unread

**Files:**
- `core/sdk/template/src/actions/mark-unread.ts` — delete
- `core/sdk/template/src/actions/close-panel.ts` — delete
- `core/sdk/template/src/actions/archive.ts` — delete
- `core/sdk/template/src/actions/next-unread.ts` — update contexts to `['thread', 'plan', 'empty']` so it appears everywhere as the sole default action

No changes needed to the SDK runtime, executor, listeners, or store — those all work generically. The template is what gets copied to `~/.anvil/quick-actions/` on first launch.

## Phase 2: Add "Mark Unread" to thread and plan context menus

**`src/components/tree-menu/thread-item.tsx`:**
- Import `CircleDot` (or `Eye`/`EyeOff`) from lucide-react and `useThreadStore`
- Add a "Mark Unread" `ContextMenuItem` above the existing "Copy Thread ID" item
- On click: call `useThreadStore.getState().markThreadAsUnread(item.id)`, then `contextMenu.close()`

**`src/components/tree-menu/plan-item.tsx`:**
- Import `CircleDot` (or matching icon) and `planService`
- Add a "Mark Unread" `ContextMenuItem` above the existing "Archive" item
- On click: call `planService.markAsUnread(item.id)`, then `contextMenu.close()`

Both services already exist and are used by the quick action SDK listeners (`src/entities/quick-actions/listeners.ts` lines 41-44 and 67-69).
