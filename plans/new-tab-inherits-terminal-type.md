# New Tab Inherits Terminal Type

When clicking the "+" button to create a new tab, if the active tab **within that panel group** is a terminal, the new tab should also be a terminal instead of a thread. This is scoped to the group — e.g. if the top panel has a thread focused but the bottom panel has a terminal, clicking "+" on the bottom panel's tab bar should create a terminal.

## Context

The "+" button logic lives in `src/components/split-layout/tab-bar.tsx` (`handleNewTab`). Currently it always creates a new thread via `threadService.create()` and opens it with `paneLayoutService.openTab({ type: "thread", ... })`.

Terminal creation requires:
1. A `worktreeId` and `worktreePath` (to spawn the PTY in the right cwd)
2. Calling `terminalSessionService.create(worktreeId, worktreePath)` which invokes the Rust `spawn_terminal` command
3. Opening a tab with `{ type: "terminal", terminalId: session.id }`

The worktree context is already available in `TabBar` via the `useMRUWorktree` hook, but terminal creation also needs a `worktreePath` which isn't currently surfaced there. We can get it from the existing terminal session's metadata or from the MRU worktree.

## Phases

- [x] Update `handleNewTab` in `tab-bar.tsx` to check the active tab's type
- [x] Create a terminal instead of a thread when the active tab is a terminal
- [x] Add test coverage for the new behavior

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Check active tab type

In `src/components/split-layout/tab-bar.tsx`, the `handleNewTab` callback needs to look at the active tab **within the same panel group** (not the globally focused tab) to determine what type of tab to create. Each `TabBar` instance is already scoped to a single group, so `tabs` and `activeTabId` props represent that group's tabs.

Use them to find the group's active tab view type:

```ts
const activeTab = tabs.find((t) => t.id === activeTabId);
const activeIsTerminal = activeTab?.view.type === "terminal";
```

## Phase 2: Create terminal when active tab is a terminal

When `activeIsTerminal` is true, create a new terminal session instead of a thread:

1. Import `terminalSessionService` from `@/entities/terminal-sessions`
2. Get the worktree path — look up the existing terminal's session to get its `worktreePath` and `worktreeId`:
   ```ts
   const existingSession = terminalSessionService.get(activeTab.view.terminalId);
   ```
3. If we have the session info, create a new terminal:
   ```ts
   const session = await terminalSessionService.create(
     existingSession.worktreeId,
     existingSession.worktreePath,
   );
   paneLayoutService.openTab(
     { type: "terminal", terminalId: session.id },
     groupId,
   );
   ```
4. Fall back to the existing thread-creation behavior if the terminal session lookup fails.

The full updated `handleNewTab` should look roughly like:

```ts
const handleNewTab = useCallback(async () => {
  // Check if the group's active tab is a terminal — if so, create another terminal
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (activeTab?.view.type === "terminal") {
    const existingSession = terminalSessionService.get(activeTab.view.terminalId);
    if (existingSession) {
      try {
        const session = await terminalSessionService.create(
          existingSession.worktreeId,
          existingSession.worktreePath,
        );
        paneLayoutService.openTab(
          { type: "terminal", terminalId: session.id },
          groupId,
        );
        return;
      } catch (err) {
        logger.error("[TabBar] Failed to create terminal, falling back to thread", err);
      }
    }
  }

  // Default: create a new thread (existing behavior)
  if (!repoId || !worktreeId) {
    logger.warn("[TabBar] No MRU worktree available, opening empty tab");
    paneLayoutService.openTab({ type: "empty" }, groupId);
    return;
  }

  const threadId = crypto.randomUUID();
  await threadService.create({ id: threadId, repoId, worktreeId, prompt: "" });
  paneLayoutService.openTab(
    { type: "thread", threadId, autoFocus: true },
    groupId,
  );
}, [groupId, tabs, activeTabId, repoId, worktreeId]);
```

Key changes:
- Add `tabs` and `activeTabId` to the dependency array
- Import `terminalSessionService`
- Terminal-first branch with graceful fallback to thread creation

## Phase 3: Test coverage

Add a test in `src/components/split-layout/__tests__/tab-interactions.test.ts` (or a new file if cleaner) that verifies:

1. Clicking "+" when the active tab is a terminal creates a terminal tab (mock `terminalSessionService.create`)
2. Clicking "+" when the active tab is a thread creates a thread tab (existing behavior preserved)
3. Clicking "+" when terminal session lookup fails falls back to thread creation

## Files to modify

- `src/components/split-layout/tab-bar.tsx` — main logic change
- `src/components/split-layout/__tests__/tab-interactions.test.ts` — test coverage
