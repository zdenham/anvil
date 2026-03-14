# Simplify Terminal Revive Logic

## Problem

Terminal restart logic is duplicated across 2 click handlers (tab-item.tsx:104-117, main-window-layout.tsx:367-377), both doing the same check-and-revive pattern. If a terminal dies while the user is already viewing it, nothing restarts it — they see `[Process exited]` and must navigate away and back. Any new navigation path (hotkey, deep link) would need its own copy.

## Approach

Move revive into a single `useEffect` in `terminal-content.tsx`. Since this component only mounts when a terminal is actively displayed, it's the natural place. `revive()` is already idempotent (no-op if alive), so it's safe to call unconditionally.

## Changes

### 1. `src/components/content-pane/terminal-content.tsx`

Add a `useEffect` that watches `isAlive` from the store and calls `revive()` when the terminal is dead and not archived:

```tsx
const session = useTerminalSessionStore(
  useCallback((s) => s.sessions[terminalId], [terminalId])
);

useEffect(() => {
  if (session && !session.isAlive && !session.isArchived) {
    terminalSessionService.revive(terminalId).catch((err) => {
      logger.warn("[TerminalContent] Failed to revive terminal (non-fatal):", err);
    });
  }
}, [session?.isAlive, session?.isArchived, terminalId]);
```

This fires when:

- Component mounts with a dead terminal (placeholder or post-restart)
- Terminal dies while being viewed (store updates `isAlive` → effect re-runs)
- User navigates to a dead terminal via any path

### 2. `src/components/split-layout/tab-item.tsx`

Remove the revive block from `handleClick` (lines 104-115). It becomes just:

```tsx
const handleClick = useCallback(() => {
  paneLayoutService.setActiveTab(groupId, tab.id);
}, [groupId, tab.id]);
```

### 3. `src/components/main-window/main-window-layout.tsx`

Remove the revive block from `handleItemSelect` (lines 368-376). The terminal case becomes just:

```tsx
} else if (itemType === "terminal") {
  await navigationService.navigateToTerminal(itemId);
}
```

## Behavior Notes

- **No visible delay**: The useEffect fires on the same render cycle as mount, so the terminal respawns before the user can interact.
- `[Process exited]` **still shows briefly**: The exit message writes to xterm before the store updates trigger re-render → revive. This is fine — the new shell spawns and output starts flowing immediately after.
- **Placeholders activate on view**: Lazy placeholders (`isAlive: false` from creation) will auto-activate when first displayed, which is the desired behavior.
- **Output buffer cleared on revive**: `revive()` calls `clearOutputBuffer()`, so the xterm instance will show old output (including `[Process exited]`) until the new shell writes. This is acceptable — the fresh prompt appears almost instantly.

## Phases

- [x] Add auto-revive useEffect to terminal-content.tsx

- [x] Remove revive logic from tab-item.tsx handleClick

- [x] Remove revive logic from main-window-layout.tsx handleItemSelect

- [x] Verify no other callers depend on the removed revive paths

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---