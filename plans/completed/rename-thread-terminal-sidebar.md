# Rename Thread or Terminal in Sidebar

Allow users to rename threads and terminals directly from the left sidebar tree menu via double-click or context menu.

## Current State

- **Threads** display `thread.name ?? "New Thread"` — the `name` field already exists on `ThreadMetadata` (core/types/threads.ts:41) and is included in `UpdateThreadInput`
- **Terminals** display `terminal.lastCommand ?? directoryName` — the `TerminalSession` type has no `name` or `label` field
- Both `ThreadItem` and `TerminalItem` already have context menus (thread has "Mark Unread" + "Copy Thread ID"; terminal has "Archive")
- `threadService.update()` already supports updating `name` via `UpdateThreadInput` and uses a **read-modify-write** pattern against disk (safe)
- `useInlineRename` **hook already exists** at `src/components/tree-menu/use-inline-rename.ts` — used by `folder-item.tsx`. Coordinates with `treeMenuService.startRename(nodeId)` / `stopRename()` via the store's `renamingNodeId`. Do NOT create a new component — reuse this hook.

## Design

**Interaction**: Double-click on the title text, press F2, or use "Rename" context menu item to enter inline edit mode. The title `<span>` is replaced with a focused `<input>` that commits on Enter/blur and cancels on Escape. **Must use the existing** `useInlineRename` **hook** — same pattern as `folder-item.tsx`.

**Input styling**: Match the existing inline rename input from `folder-item.tsx`:

```
className="bg-transparent border-b border-zinc-500 outline-none px-0 py-0 text-inherit font-inherit w-full min-w-[60px]"
```

**Threads**: Write to `thread.name` via `threadService.update(id, { name })`. This already does read-modify-write on disk (reads current disk state, merges the update, writes back) — no race condition.

**Terminals**: Add an optional `label` field to `TerminalSession` schema. When set, display `label` instead of `lastCommand`. Terminals ARE persisted to disk (`~/.mort/terminal-sessions/{id}/metadata.json`), so `setLabel` must use the **read-modify-write** pattern to avoid clobbering concurrent writes from `updateLastCommand` or `markExited`.

### Race Condition Safety

**Thread rename**: Already safe. `threadService.update()` does read-modify-write — it reads disk state, spreads updates on top, and writes back. The `optimistic()` helper handles store rollback on failure.

**Terminal rename**: `terminalSessionService.persistMetadata()` currently reads from the in-memory store and overwrites disk. This means two concurrent fire-and-forget `persistMetadata` calls can race. The new `setLabel` method must:

1. Read current in-memory session from the store
2. Update the store optimistically
3. When persisting: read current disk state, merge only the `label` field, write back

Alternatively (simpler, matching the existing `persistMetadata` pattern): since all terminal metadata writes go through the same single-threaded JS event loop and `persistMetadata` reads the latest store state, the existing pattern is safe as long as `setLabel` updates the store first, then calls `persistMetadata` (same as `updateLastCommand` does). The store is always the source of truth and `persistMetadata` snapshots it. No disk read-modify-write needed here — just follow the existing `updateLastCommand` pattern exactly.

## Phases

- [x] Add `label` field to `TerminalSession` type and `setLabel` to terminal session service

- [x] Add rename support to `ThreadItem` using `useInlineRename` hook (double-click + F2 + context menu "Rename")

- [x] Add rename support to `TerminalItem` using `useInlineRename` hook (double-click + F2 + context menu "Rename")

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Detail

### Phase 1: Add `label` to `TerminalSession`

**Files:**

- `src/entities/terminal-sessions/types.ts` — add `label: z.string().optional()` to `TerminalSessionSchema`
- `src/entities/terminal-sessions/service.ts` — add `setLabel(id, label)` method:

  ```ts
  setLabel(id: string, label: string): void {
    useTerminalSessionStore.getState().updateSession(id, { label });
    // Fire-and-forget disk write — same pattern as updateLastCommand
    this.persistMetadata(id);
  }
  ```

  This follows the exact same pattern as `updateLastCommand` — update store first, then fire-and-forget `persistMetadata`. Safe because JS is single-threaded and `persistMetadata` always reads the latest store snapshot.
- `src/hooks/use-tree-data.ts` — update terminal title derivation: `terminal.label ?? terminal.lastCommand ?? directoryName`

### Phase 2: Rename in `ThreadItem`

**File:** `src/components/tree-menu/thread-item.tsx`

Use the **existing** `useInlineRename` **hook** (same as `folder-item.tsx`):

```tsx
const renamingNodeId = useTreeMenuStore((s) => s.renamingNodeId);
const rename = useInlineRename({
  currentName: item.title,
  onRename: async (newName) => {
    await threadService.update(item.id, { name: newName });
  },
});

useEffect(() => {
  if (renamingNodeId === item.id && !rename.isRenaming) rename.startRename();
}, [renamingNodeId === item.id]);
```

- `threadService.update()` already does read-modify-write on disk — reads current metadata.json, merges the update, writes back. No additional safety needed.
- Double-click on title → `rename.startRename()`
- F2 key → `rename.startRename()`
- Add "Rename" to existing context menu (with `Pencil` icon) → calls `treeMenuService.startRename(item.id)` then closes menu
- When `rename.isRenaming`, render `<input>` with same className as folder-item instead of the title `<span>`

### Phase 3: Rename in `TerminalItem`

**File:** `src/components/tree-menu/terminal-item.tsx`

Same pattern as Phase 2 but calls `terminalSessionService.setLabel(item.id, value)`:

```tsx
const renamingNodeId = useTreeMenuStore((s) => s.renamingNodeId);
const rename = useInlineRename({
  currentName: item.title,
  onRename: async (newName) => {
    terminalSessionService.setLabel(item.id, newName);
  },
});

useEffect(() => {
  if (renamingNodeId === item.id && !rename.isRenaming) rename.startRename();
}, [renamingNodeId === item.id]);
```

- TerminalItem already has a context menu — add "Rename" item with `Pencil` icon
- Double-click on title → `rename.startRename()`
- F2 key → `rename.startRename()`
- When `rename.isRenaming`, render `<input>` instead of the title `<span>`