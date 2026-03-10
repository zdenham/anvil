# Fix Duplicate Terminal Input (Characters Printed Multiple Times)

## Problem

Every character typed in a terminal is printed several times, indicating duplicate event listeners processing `terminal:output` events.

## Root Cause

`setupEntityListeners()` **registers duplicate listeners on every call, and its guard doesn't prevent re-registration.**

In `src/entities/index.ts:247-278`:

```ts
let listenersInitialized = false;

export function setupEntityListeners(options: EntityInitOptions = {}): void {
  if (listenersInitialized) {
    logger.warn("[entities:listeners] Re-initializing entity listeners (HMR?)");
  }
  // ⚠️ Proceeds to register ALL listeners AGAIN — no early return
  setupTerminalListeners(); // cleanup function is DISCARDED
  // ...
  listenersInitialized = true;
}
```

**Why it gets called multiple times:**

1. **React StrictMode** (`src/main.tsx:92`) — double-mounts the App component. The bootstrap effect in `App.tsx:65-102` runs `setupEntityListeners()` twice. The effect cleanup (`App.tsx:99-101`) only cleans up `cleanupAgentMessageListener`, not entity listeners.

2. **HMR** — re-executes the module, resetting the `listenersInitialized` flag. Old WS handlers in `events.ts`'s `wsListeners` Map persist across module reloads.

**The duplication chain:**

1. User types a character → `terminal.onData` → `terminalSessionService.write()` → Rust PTY
2. Rust echoes back via `terminal:output` WS event
3. Each registered `terminal:output` handler calls `appendOutput(termId, text)`
4. `appendOutput` notifies the xterm subscriber via `outputListeners`, calling `terminal.write(text)`
5. With N duplicate handlers, xterm writes the character N times

## Fix

The fix has two parts:

### Part 1: `setupEntityListeners` must clean up before re-registering

Store cleanup functions from each `setup*Listeners()` call. Before re-registering, invoke all previous cleanups. This makes the function idempotent.

```ts
// src/entities/index.ts
let cleanupFns: Array<() => void> = [];

export function setupEntityListeners(options: EntityInitOptions = {}): () => void {
  // Clean up previous listeners before registering new ones
  for (const cleanup of cleanupFns) {
    cleanup();
  }
  cleanupFns = [];

  // Each setup returns a cleanup function — store them all
  cleanupFns.push(setupThreadListeners());
  cleanupFns.push(setupRepositoryListeners());
  // ... all other setupXxxListeners() calls ...
  cleanupFns.push(setupTerminalListeners());

  // Return a master cleanup for the caller
  return () => {
    for (const cleanup of cleanupFns) {
      cleanup();
    }
    cleanupFns = [];
  };
}
```

**Prerequisite**: Several `setup*Listeners()` functions don't currently return cleanup functions. Each one needs to be audited and updated to return `() => void`. The terminal one already does — the others need the same treatment.

### Part 2: `App.tsx` must call cleanup on unmount

```ts
// src/App.tsx, inside the bootstrap useEffect
const cleanupEntityListeners = setupEntityListeners();

return () => {
  cleanupAgentMessageListener();
  cleanupEntityListeners();
};
```

This ensures StrictMode double-mount doesn't leave stale listeners.

## Files to Modify

| File | Change |
| --- | --- |
| `src/entities/index.ts` | Clean up previous listeners before re-registering; store and return cleanup functions |
| `src/App.tsx` | Store and invoke the cleanup function from `setupEntityListeners` on unmount |
| `src/entities/threads/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/repositories/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/permissions/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/questions/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/plans/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/relations/listeners.ts` | Return cleanup function (if not already) |
| `src/stores/tree-menu/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/worktrees/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/quick-actions/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/api-health/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/comments/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/folders/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/pull-requests/listeners.ts` | Return cleanup function (if not already) |
| `src/entities/gateway-channels/listeners.ts` | Return cleanup function (if not already) |
| `src/spotlight-main.tsx` | Same cleanup pattern for non-main window |
| `src/control-panel-main.tsx` | Same cleanup pattern for non-main window |

## Phases

- [x] Audit all `setup*Listeners()` functions — ensure each returns a cleanup function

- [x] Update `setupEntityListeners` to clean up previous listeners before re-registering and return a master cleanup

- [x] Update `App.tsx`, `spotlight-main.tsx`, and `control-panel-main.tsx` to call cleanup on unmount

- [x] Verify fix: confirm only one set of terminal listeners is active after StrictMode double-mount

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---