# Fix: Archived terminal leaves bricked tab instead of closing/showing empty state

## Problem

When a terminal is archived (killed) from the tree menu sidebar, the tab in the content pane stays open showing a dead xterm.js instance — a "bricked" terminal with no input, no output, no way to interact. The expected behavior is either:
- The tab closes (if other tabs exist), or
- The empty state displays (if it's the last tab)

## Root Cause

Threads and plans have an event-driven tab cleanup pattern:
1. `threadService.archive()` → emits `THREAD_ARCHIVED` event
2. `setupPaneLayoutListeners()` in `src/stores/pane-layout/listeners.ts` catches it → calls `closeMatchingTabs()` → closes/replaces the tab

Terminals **lack this entire chain**:
- No `TERMINAL_ARCHIVED` event exists in `EventName` (`core/types/events.ts`)
- No listener in `setupPaneLayoutListeners()` for terminal archiving
- `terminalSessionService.archive()` only kills the PTY and marks the store entry as archived — it never touches the pane layout

The content pane header's `TerminalHeader` did call `onClose()` after archiving (line 419 of `content-pane-header.tsx`), but the header is commented out in `ContentPane` (lines 140-149), so that path is dead. The tree menu's `TerminalItem` calls `terminalSessionService.archive()` directly with no tab cleanup.

## Key Files

| File | Role |
|------|------|
| `core/types/events.ts` | Event names + payload types |
| `src/entities/terminal-sessions/service.ts` | `archive()` method |
| `src/stores/pane-layout/listeners.ts` | Tab cleanup on archive events |
| `src/stores/pane-layout/__tests__/listeners.test.ts` | Tests for archive tab cleanup |
| `src/entities/events.ts` | `eventBus` singleton |

## Phases

- [x] Add `TERMINAL_ARCHIVED` event and wire it up
- [x] Add tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `TERMINAL_ARCHIVED` event and wire it up

### 1a. Add event to `core/types/events.ts`

Add to `EventName`:
```ts
TERMINAL_ARCHIVED: "terminal:archived",
```

Add to `EventPayloads`:
```ts
[EventName.TERMINAL_ARCHIVED]: { terminalId: string };
```

Add to `EventNameSchema` z.enum array.

### 1b. Emit event from `terminalSessionService.archive()`

In `src/entities/terminal-sessions/service.ts`, import `eventBus` and emit after successful archive:

```ts
import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events.js";

// Inside archive(), after removeSession:
eventBus.emit(EventName.TERMINAL_ARCHIVED, { terminalId: id });
```

### 1c. Add listener in `setupPaneLayoutListeners()`

In `src/stores/pane-layout/listeners.ts`, add a handler matching the thread/plan pattern:

```ts
eventBus.on(
  EventName.TERMINAL_ARCHIVED,
  ({ terminalId }: EventPayloads[typeof EventName.TERMINAL_ARCHIVED]) => {
    closeMatchingTabs(
      (view) => view.type === "terminal" && view.terminalId === terminalId,
    ).catch((e) => {
      logger.error(`[PaneLayoutListener] Failed to close archived terminal tabs ${terminalId}:`, e);
    });
    logger.info(`[PaneLayoutListener] Closed tabs for archived terminal ${terminalId}`);
  },
);
```

This automatically handles both behaviors via `paneLayoutService.closeTab()`:
- **Last tab in last group** → replaces with `{ type: "empty" }` (shows empty state)
- **Other tabs exist** → closes the tab and activates an adjacent one

## Phase 2: Add tests

Add test cases in `src/stores/pane-layout/__tests__/listeners.test.ts` following the existing `THREAD_ARCHIVED` / `PLAN_ARCHIVED` test patterns:
- Terminal tab is closed when `TERMINAL_ARCHIVED` fires
- Last-tab-in-last-group transitions to empty state
- Tabs in other groups for the same terminal are also closed
