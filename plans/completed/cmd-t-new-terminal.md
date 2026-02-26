# Cmd+T: New Terminal in MRU Worktree

Add a `Cmd+T` keyboard shortcut that creates a new terminal session in the most recently used worktree and navigates to it.

## Context

- `Cmd+N` already creates a new thread in the MRU worktree (or selected item's worktree) — same pattern
- `handleNewTerminal(worktreeId, worktreePath)` already exists in `main-window-layout.tsx:341` and does exactly what we need (creates session via `terminalSessionService.create`, navigates to it)
- Tree sections from `useTreeData` are sorted MRU-first, so `treeSections[0]` gives the most recent worktree — same approach Cmd+N uses
- No existing `Cmd+T` binding in the codebase

## Phases

- [x] Add Cmd+T keyboard listener in `main-window-layout.tsx`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

### Single change: `src/components/main-window/main-window-layout.tsx`

Add a new `useEffect` block alongside the existing Cmd+P (line 102) and Cmd+N (line 114) handlers:

```typescript
// Listen for Command+T / Ctrl+T to create new terminal in MRU worktree
useEffect(() => {
  const handleKeyDown = async (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "t") {
      e.preventDefault();

      const sections = treeSectionsRef.current;
      if (sections.length === 0) {
        logger.warn("[MainWindowLayout] Command+T: No worktrees available");
        return;
      }

      const mostRecent = sections[0];
      logger.info(
        `[MainWindowLayout] Command+T: Creating terminal in worktree "${mostRecent.worktreeName}"`
      );

      await handleNewTerminal(mostRecent.worktreeId, mostRecent.worktreePath);
    }
  };

  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [handleNewTerminal]);
```

**Why this works:**
- Follows exact same pattern as Cmd+N (lines 114-186)
- Uses `treeSectionsRef` to avoid stale closures (already maintained at line 91-92)
- Delegates to existing `handleNewTerminal` callback (line 341) which handles session creation + navigation
- `handleNewTerminal` is `useCallback`-wrapped and stable, safe as a dependency
- `e.preventDefault()` stops the browser's default new-tab behavior

Place this after the Cmd+N `useEffect` block (after line 186) to keep shortcuts grouped together.
