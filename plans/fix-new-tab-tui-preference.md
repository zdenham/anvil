# Fix: New Tab Button Doesn't Respect TUI Preference

## Problem

When `preferTerminalInterface` is enabled, clicking the "+" (new tab) button in the tab bar opens an empty pane with a GUI-style text input. The user must type a prompt and submit before the TUI preference kicks in (inside `createThread()`). This is a poor UX because:

1. The user sees GUI chrome (empty pane + input box) when they expect a terminal
2. TUI threads don't require a prompt — Claude CLI has its own REPL — so forcing prompt entry is unnecessary
3. Inconsistent with how the "+" button already special-cases terminal tabs (creates another terminal directly)

## Design

When the user clicks "+", if `preferTerminalInterface` is enabled:
- Skip the empty pane entirely
- Directly create a TUI thread using the MRU worktree context
- Open the resulting thread view immediately

This mirrors the existing pattern where clicking "+" on a terminal tab directly creates a new terminal session.

### Fallback
If no MRU worktree is available (no repos configured), fall back to the empty pane as today — the empty pane already handles the "no repo" state with the welcome/import UI.

## Phases

- [x] Update `handleNewTab` in `tab-bar.tsx` to check `preferTerminalInterface` and directly create a TUI thread
- [x] Verify empty pane fallback when no worktree is available

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: Update `handleNewTab` in `tab-bar.tsx`

**File:** `src/components/split-layout/tab-bar.tsx`

In `handleNewTab`, add a new branch before the `openTab({ type: "empty" })` fallback:

1. Read `preferTerminalInterface` from `useSettingsStore`
2. If enabled, get MRU worktree context (from `useMRUWorktreeStore` + `useRepoWorktreeLookupStore` — use store `.getState()` since this is a callback, not a render)
3. If worktree context is available, call `createTuiThread({ repoId, worktreeId, worktreePath })` with no prompt
4. Open the resulting thread: `paneLayoutService.openTab({ type: "thread", threadId: result.threadId }, groupId)`
5. If worktree context is unavailable or TUI creation fails, fall back to empty pane

**Imports to add:**
- `useSettingsStore` from `@/entities/settings/store`
- `useMRUWorktreeStore` from `@/stores/mru-worktree-store`
- `useRepoWorktreeLookupStore` from `@/stores/repo-worktree-lookup-store`
- `createTuiThread` from `@/lib/thread-creation-service`

**Sketch:**
```typescript
const handleNewTab = useCallback(async () => {
  // Existing: if active tab is terminal, create another terminal
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (activeTab?.view.type === "terminal") {
    // ... existing terminal logic ...
  }

  // NEW: if TUI preference, directly create TUI thread
  const preferTui = useSettingsStore.getState().workspace.preferTerminalInterface ?? false;
  if (preferTui) {
    const mru = useMRUWorktreeStore.getState().getMRUWorktree();
    if (mru) {
      const worktreePath = useRepoWorktreeLookupStore.getState()
        .getWorktreePath(mru.repoId, mru.worktreeId);
      if (worktreePath) {
        try {
          const result = await createTuiThread({
            repoId: mru.repoId,
            worktreeId: mru.worktreeId,
            worktreePath,
          });
          paneLayoutService.openTab(
            { type: "thread", threadId: result.threadId },
            groupId,
          );
          return;
        } catch (err) {
          logger.error("[TabBar] Failed to create TUI thread, falling back to empty", err);
        }
      }
    }
  }

  // Fallback: open empty tab
  paneLayoutService.openTab({ type: "empty" }, groupId);
}, [groupId, tabs, activeTabId]);
```

### Phase 2: Verify fallback

Confirm that when no repos are configured (MRU returns null), the "+" button still opens the empty pane with the welcome/import UI. This is a code-reading verification — no changes expected.
