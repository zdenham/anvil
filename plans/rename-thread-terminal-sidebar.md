# Rename Thread or Terminal in Sidebar

Allow users to rename threads and terminals directly from the left sidebar tree menu via double-click or context menu.

## Current State

- **Threads** display `thread.name ?? "New Thread"` — the `name` field already exists on `ThreadMetadata` (core/types/threads.ts:41) and is included in `UpdateThreadInput`
- **Terminals** display `terminal.lastCommand ?? directoryName` — the `TerminalSession` type has no `name` or `label` field
- Both `ThreadItem` and `TerminalItem` already have context menus (thread has "Mark Unread" + "Copy Thread ID"; terminal has none)
- `threadService.update()` already supports updating `name` via `UpdateThreadInput`

## Design

**Interaction**: Double-click on the title text or use "Rename" context menu item to enter inline edit mode. The title `<span>` is replaced with a focused `<input>` that commits on Enter/blur and cancels on Escape. Same pattern used by VS Code file rename.

**Threads**: Write to `thread.name` via `threadService.update(id, { name })`. Already supported end-to-end (persists to disk).

**Terminals**: Add an optional `label` field to `TerminalSession` schema. When set, display `label` instead of `lastCommand`. Since terminals are in-memory only (no disk persistence), this just needs a store update via `updateSession`.

## Phases

- [ ] Add `label` field to `TerminalSession` type and `setLabel` to terminal session service/store

- [ ] Create `InlineRenameInput` reusable component for inline text editing

- [ ] Add rename support to `ThreadItem` (double-click + context menu "Rename")

- [ ] Add rename support to `TerminalItem` (double-click + context menu "Rename")

- [ ] Add context menu to `TerminalItem` (it currently has none) with "Rename" option

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Detail

### Phase 1: Add `label` to `TerminalSession`

**Files:**

- `src/entities/terminal-sessions/types.ts` — add `label: z.string().optional()` to `TerminalSessionSchema`
- `src/entities/terminal-sessions/service.ts` — add `setLabel(id, label)` method that calls `updateSession`
- `src/hooks/use-tree-data.ts:196` — update terminal title derivation: `terminal.label ?? terminal.lastCommand ?? directoryName`

### Phase 2: `InlineRenameInput` component

**File:** `src/components/ui/inline-rename-input.tsx` (new)

Small reusable component:

```tsx
interface InlineRenameInputProps {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}
```

- Auto-focuses and selects all text on mount
- Commits on Enter or blur (if value changed and non-empty)
- Cancels on Escape
- Matches the existing tree item text styling (`text-[13px] leading-[22px]`)

### Phase 3: Rename in `ThreadItem`

**File:** `src/components/tree-menu/thread-item.tsx`

- Add `isRenaming` state
- Double-click on title `<span>` → set `isRenaming = true`
- Add "Rename" to existing context menu (with `Pencil` icon)
- When renaming, render `<InlineRenameInput>` instead of the title `<span>`
- On commit: call `threadService.update(item.id, { name: value })`
- On cancel: set `isRenaming = false`

### Phase 4: Rename in `TerminalItem`

**File:** `src/components/tree-menu/terminal-item.tsx`

- Add `isRenaming` state
- Double-click on title `<span>` → set `isRenaming = true`
- When renaming, render `<InlineRenameInput>` instead of the title `<span>`
- On commit: call `terminalSessionService.setLabel(item.id, value)`
- On cancel: set `isRenaming = false`

### Phase 5: Context menu for `TerminalItem`

**File:** `src/components/tree-menu/terminal-item.tsx`

- Add `useContextMenu` hook + `ContextMenu` portal (same pattern as `ThreadItem`)
- Add `onContextMenu={contextMenu.open}` to the row
- Menu items: "Rename" (`Pencil` icon)
- Optionally: "Copy Terminal ID" (`Copy` icon)