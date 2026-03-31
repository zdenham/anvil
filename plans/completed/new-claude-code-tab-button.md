# New Claude Code Session Shortcut

## Problem

There's no quick way to create a new Claude Code (TUI) session. Users must either switch the global `preferTerminalInterface` setting or have a terminal tab already active.

## Solution

Add a `Cmd+Shift+T` keyboard shortcut that directly creates a new Claude Code (TUI) session, mirroring how `Cmd+T` creates a new terminal.

## Phases

- [x] Register `Cmd+Shift+T` shortcut in `main-window-layout.tsx` alongside existing shortcuts, wired to create a new TUI thread and open it as a tab

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Implementation Notes

- Register the shortcut in the same `useEffect` block where `Cmd+T` (new terminal) is registered in `main-window-layout.tsx`
- Use `createTuiThread` from `@/lib/thread-creation-service` to create the session
- Use `paneLayoutService.openTab({ type: "thread", threadId }, groupId)` to open it
- Resolve MRU worktree context the same way the existing `handleNewTab` does