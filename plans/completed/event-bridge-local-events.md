# Event Bridge: Local Window Events Extension

## Problem

Components bypass the event bridge and use direct `listen()` calls for window-specific Tauri events. This creates inconsistent cleanup patterns that cause race conditions:

```
[UnhandledRejection] undefined is not an object (evaluating 'listeners[eventId].handlerId')
```

The error occurs because Tauri's `listen()` returns a Promise, and cleanup can race with registration.

**Current problematic patterns:**

```typescript
// Pattern A: Race condition with mutable variable (spotlight.tsx:267-291)
let unlisten: UnlistenFn | null = null;
listen(...).then((fn) => { unlisten = fn; });
// Later: unlisten?.() - may be null if called before promise resolves

// Pattern B: Cleanup races with async registration
useEffect(() => {
  const unlisten = listen(...);  // Promise
  return () => unlisten.then((fn) => fn());  // Race in StrictMode
}, []);

// Pattern C: Discarded cleanup functions
await setupIncomingBridge();  // Returns UnlistenFn[] but never used
```

## Solution

Extend the event bridge to handle local window events, giving components a single synchronous API (`eventBus.on/off`) for all events.

**After:**
```typescript
// Components never import from @tauri-apps/api/event
// All events go through mitt - synchronous, no cleanup races
useEffect(() => {
  const handler = () => { ... };
  eventBus.on("panel-hidden", handler);
  return () => eventBus.off("panel-hidden", handler);  // Synchronous!
}, []);
```

## Important: Event Prefix Clarification

**Tauri `emit()` without `app:` prefix broadcasts to ALL windows.** This is how window coordination events work:

```typescript
// In task-main.tsx - emits to all windows (no prefix needed for window coordination)
emit("task-panel-ready", { threadId });

// In spotlight-main.tsx - incoming bridge listens for raw event name
listen("task-panel-ready", handler);  // Receives from any window
```

The `app:` prefix convention is used for **outgoing bridge events** (local eventBus → Tauri broadcast) to namespace them. Window coordination events like `task-panel-ready` are emitted directly via Tauri's `emit()` and don't need the prefix.

**Key distinction:**
- `BROADCAST_EVENTS`: Use `app:` prefix (outgoing bridge transforms local → Tauri)
- `WINDOW_COORDINATION_EVENTS`: No prefix (direct Tauri emit between windows)
- `RUST_PANEL_EVENTS`: No prefix (Rust emits directly to specific window)
- `WINDOW_API_EVENTS`: No prefix (synthetic events from window APIs)

## Key Architectural Notes

### Pull Model Remains Necessary

**Important**: The bridge-based event system does NOT replace the Pull Model. Mitt does not queue events - if there's no listener when `emit()` is called, the event is dropped.

Example race condition:
1. `simple-task-main.tsx` bootstrap runs, calls `setupIncomingBridge()`
2. Bridge registers listener for `open-simple-task`
3. Rust emits `open-simple-task` event
4. Bridge receives it, calls `eventBus.emit("open-simple-task", payload)`
5. `SimpleTaskWindow` component hasn't mounted yet
6. Event is lost

**Mitigation**: Components must continue using the Pull Model (`get_pending_simple_task`, `get_pending_task`) to fetch initial state from Rust on mount. The event bridge handles ongoing events after mount, not initial state.

### Window Isolation

Each window has its own JavaScript context and its own `eventBus` instance. When Rust emits `panel-hidden` to Window A, only Window A's bridge forwards it to Window A's local `eventBus`. This isolation is automatic and requires no special handling.

### Event Categories

To avoid confusion, we distinguish between event types:

| Category | Description | Examples |
|----------|-------------|----------|
| `BROADCAST_EVENTS` | Cross-window events via `app:` prefix | `agent:state`, `task:updated` |
| `RUST_PANEL_EVENTS` | Events emitted by Rust to specific windows | `panel-hidden`, `panel-shown`, `show-error` |
| `WINDOW_COORDINATION_EVENTS` | Events between TypeScript windows | `task-panel-ready` |
| `WINDOW_API_EVENTS` | Synthetic events from Tauri window APIs | `window:focus-changed` |

---

## Implementation

### Step 1: Inventory all direct Tauri API calls

**Direct `listen()` calls:**

| File | Event | Purpose |
|------|-------|---------|
| `src/components/tasks-panel/tasks-panel.tsx` | `panel-hidden`, `panel-shown` | Panel visibility |
| `src/components/simple-task/use-simple-task-params.ts` | `open-simple-task` | Receive task params |
| `src/components/spotlight/spotlight.tsx` | `task-panel-ready` | Coordination |
| `src/components/clipboard/clipboard-manager.tsx` | `clipboard-entry-added` | Clipboard updates |
| `src/components/error-panel.tsx` | `show-error`, `panel-hidden` | Error display |
| `src/task-main.tsx` | `open-task` | Task panel routing |
| `src/clipboard-main.tsx` | `panel-hidden` | Panel visibility |

**Window API calls (`getCurrentWindow().onFocusChanged`):**

| File | Purpose |
|------|---------|
| `src/components/spotlight/spotlight.tsx:875` | Focus input when panel gains focus |
| `src/components/spotlight/SearchBar.tsx:22` | Clear query when window loses focus |
| `src/components/clipboard/clipboard-manager.tsx:121` | Focus input when panel gains focus |

These have the same async cleanup problem as `listen()` - they return a Promise that resolves to an unlisten function.

### Step 2: Define event categories in event-bridge.ts

```typescript
// event-bridge.ts

// Events broadcast across windows (existing)
const BROADCAST_EVENTS = [
  EventName.AGENT_SPAWNED,
  EventName.AGENT_STATE,
  // ... existing events
] as const;

// Events from Rust backend to specific windows
const RUST_PANEL_EVENTS = [
  "panel-hidden",
  "panel-shown",
  "open-simple-task",
  "clipboard-entry-added",
  "show-error",
  "open-task",
] as const;

// Events coordinating between TypeScript windows
// These are emitted by one window and received by another
const WINDOW_COORDINATION_EVENTS = [
  "task-panel-ready",
] as const;

// Synthetic events generated by the bridge from window APIs
const WINDOW_API_EVENTS = [
  "window:focus-changed",
] as const;

// Combined local events (all non-broadcast events)
const LOCAL_EVENTS = [
  ...RUST_PANEL_EVENTS,
  ...WINDOW_COORDINATION_EVENTS,
] as const;

type LocalEvent = typeof LOCAL_EVENTS[number];
type WindowApiEvent = typeof WINDOW_API_EVENTS[number];

// Runtime check: ensure no overlap between ALL event categories
if (import.meta.env.DEV) {
  const broadcastSet = new Set(BROADCAST_EVENTS as unknown as string[]);
  const localSet = new Set(LOCAL_EVENTS as unknown as string[]);

  // Check LOCAL_EVENTS vs BROADCAST_EVENTS
  for (const event of LOCAL_EVENTS) {
    if (broadcastSet.has(event)) {
      console.error(`[event-bridge] CRITICAL: "${event}" is in both BROADCAST_EVENTS and LOCAL_EVENTS!`);
    }
  }

  // Check WINDOW_API_EVENTS vs BROADCAST_EVENTS
  for (const event of WINDOW_API_EVENTS) {
    if (broadcastSet.has(event)) {
      console.error(`[event-bridge] CRITICAL: "${event}" is in both BROADCAST_EVENTS and WINDOW_API_EVENTS!`);
    }
  }

  // Check WINDOW_API_EVENTS vs LOCAL_EVENTS
  for (const event of WINDOW_API_EVENTS) {
    if (localSet.has(event)) {
      console.error(`[event-bridge] CRITICAL: "${event}" is in both LOCAL_EVENTS and WINDOW_API_EVENTS!`);
    }
  }
}
```

### Step 3: Extend setupIncomingBridge with HMR support

```typescript
import { getCurrentWindow } from "@tauri-apps/api/window";

// Module-level state for HMR cleanup
let bridgeInitialized = false;
let previousCleanup: UnlistenFn[] = [];

async function registerTauriToMitt(
  tauriEvent: string,
  mittEvent: string
): Promise<UnlistenFn | null> {
  try {
    const unlisten = await listen(tauriEvent, (event) => {
      if (shouldDebugEvents()) {
        logger.debug(`[event-bridge] ${tauriEvent} → mitt ${mittEvent}`);
      }
      eventBus.emit(mittEvent as any, event.payload);
    });
    return unlisten;
  } catch (error) {
    logger.error(`[event-bridge] Failed to register ${tauriEvent}:`, error);
    return null;
  }
}

// Returns array for consistency and future extensibility (window:moved, window:resized, etc.)
async function registerWindowEvents(): Promise<UnlistenFn[]> {
  const unlisteners: UnlistenFn[] = [];

  try {
    const unlisten = await getCurrentWindow().onFocusChanged((event) => {
      if (shouldDebugEvents()) {
        logger.debug(`[event-bridge] window focus changed: ${event.payload}`);
      }
      eventBus.emit("window:focus-changed", { focused: event.payload });
    });
    unlisteners.push(unlisten);
  } catch (error) {
    logger.error(`[event-bridge] Failed to register window focus:`, error);
  }

  // Future: Add more window API events here
  // try {
  //   const unlisten = await getCurrentWindow().onMoved(...);
  //   unlisteners.push(unlisten);
  // } catch (error) { ... }

  return unlisteners;
}

// Debug logging toggle for high-volume events (lazy to avoid SSR issues)
function shouldDebugEvents(): boolean {
  return import.meta.env.DEV &&
         typeof localStorage !== 'undefined' &&
         localStorage.getItem('debug:events') === 'true';
}

export async function setupIncomingBridge(): Promise<UnlistenFn[]> {
  // HMR support: clean up previous listeners before re-registering
  if (bridgeInitialized && previousCleanup.length > 0) {
    logger.log("[event-bridge] HMR detected - cleaning up previous listeners");
    previousCleanup.forEach(fn => {
      try {
        fn();
      } catch (e) {
        // Log cleanup errors in dev mode to help diagnose issues
        if (import.meta.env.DEV) {
          logger.debug("[event-bridge] HMR cleanup error (non-fatal):", e);
        }
      }
    });
    previousCleanup = [];
  }
  bridgeInitialized = true;

  logger.log("[event-bridge] Setting up incoming bridge...");

  // Register broadcast events (app: prefixed from other windows)
  const broadcastResults = await Promise.all(
    BROADCAST_EVENTS.map((name) =>
      registerTauriToMitt(`app:${name}`, name)
    )
  );

  // Register local events (from Rust backend and window coordination)
  const localResults = await Promise.all(
    LOCAL_EVENTS.map((name) =>
      registerTauriToMitt(name, name)
    )
  );

  // Register window API events (returns array)
  const windowApiUnlisteners = await registerWindowEvents();

  const unlisteners = [
    ...broadcastResults,
    ...localResults,
    ...windowApiUnlisteners,
  ].filter((fn): fn is UnlistenFn => fn !== null);

  // Store for HMR cleanup
  previousCleanup = unlisteners;

  logger.log(`[event-bridge] Registered ${unlisteners.length} listeners`);

  // Warn if registration count doesn't match expected
  const status = getBridgeStatus();
  if (status.registered < status.expected) {
    logger.warn(`[event-bridge] Only ${status.registered}/${status.expected} listeners registered - some events may not work`);
  }

  return unlisteners;
}

/**
 * Returns the count of successfully registered listeners.
 * Components can use this to verify their required events are available.
 */
export function getBridgeStatus(): { registered: number; expected: number } {
  return {
    registered: previousCleanup.length,
    expected: BROADCAST_EVENTS.length + LOCAL_EVENTS.length + WINDOW_API_EVENTS.length,
  };
}
```

### Step 4: Bootstrap cleanup pattern (entry points)

**Important**: Bridge setup must happen in the entry point bootstrap, NOT in React components. This avoids StrictMode double-mount issues.

```typescript
// simple-task-main.tsx (and other *-main.tsx files)

import { getCurrentWindow } from "@tauri-apps/api/window";

let bridgeCleanup: UnlistenFn[] = [];
let cleanupRegistered = false;

async function bootstrap() {
  // Setup bridge FIRST, before React renders
  bridgeCleanup = await setupIncomingBridge();

  // Register cleanup handler once
  // Note: onCloseRequested also returns a promise, but this is fine
  // because we're not in a React lifecycle - we're in bootstrap
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    getCurrentWindow().onCloseRequested(async () => {
      logger.log("[bootstrap] Window closing - cleaning up bridge listeners");
      for (const fn of bridgeCleanup) {
        try {
          fn();
        } catch (error) {
          // Log but don't throw - we want to clean up as much as possible
          logger.error("[bootstrap] Cleanup error:", error);
        }
      }
    });
  }

  // Continue with rest of bootstrap...
  await hydrateEntities();
  setupEntityListeners();

  // React render happens last
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
}
```

**Entry point requirements:**

| Entry Point | Needs Incoming Bridge? | Reason |
|-------------|----------------------|--------|
| `simple-task-main.tsx` | Yes | `open-simple-task`, `panel-hidden`, `window:focus-changed` |
| `task-main.tsx` | Yes | `open-task`, `panel-hidden` |
| `tasks-panel-main.tsx` | Yes | `panel-hidden`, `panel-shown` |
| `spotlight-main.tsx` | Yes (NEW) | `task-panel-ready`, `window:focus-changed` |
| `clipboard-main.tsx` | Yes | `clipboard-entry-added`, `panel-hidden`, `window:focus-changed` |
| `error-main.tsx` | Yes (NEW) | `show-error`, `panel-hidden` |

### Step 5: Update type definitions

The current `AppEvents` type maps over `EventNameType` from core. Local events are NOT in `EventNameType` and should not be - core shouldn't know about frontend events.

**Solution**: Create a union type that combines core events with local events.

```typescript
// src/entities/events.ts

import mitt from "mitt";
import {
  EventName,
  EventPayloads,
  type EventNameType,
  type ThreadState,
} from "@core/types/events.js";

// Re-export for convenience
export { EventName, type EventPayloads, type EventNameType };
export type { ThreadState };

/**
 * Core events from the agent/backend system.
 * These are defined in @core/types/events.ts
 */
type CoreEvents = {
  [K in EventNameType]: EventPayloads[K] & {
    _source?: "agent" | "local";
  };
};

/**
 * Local window events (frontend-only).
 * These are NOT in @core/types/events.ts
 */
type LocalEvents = {
  // Rust panel events
  "panel-hidden": void;
  "panel-shown": void;
  "open-simple-task": { threadId: string; taskId: string; prompt?: string };
  "clipboard-entry-added": void;
  "show-error": unknown;
  "open-task": OpenTaskPayload;

  // Window coordination events
  "task-panel-ready": { threadId: string };

  // Window API events (synthetic, from bridge)
  "window:focus-changed": { focused: boolean };
};

// Import or define OpenTaskPayload
interface OpenTaskPayload {
  taskId: string;
  threadId?: string;
  // Add other fields as needed
}

/**
 * Combined event types for the frontend event bus.
 * This union maintains proper type layering - core doesn't know about local events.
 */
export type AppEvents = CoreEvents & LocalEvents;

/** Global event bus - single instance per window */
export const eventBus = mitt<AppEvents>();
```

### Step 6: Migrate components

**Before (tasks-panel.tsx):**
```typescript
useEffect(() => {
  const unlistenHidden = listen("panel-hidden", () => {
    logger.info("[tasks-panel] Panel hidden");
  });
  return () => {
    unlistenHidden.then((f) => f());
  };
}, []);
```

**After:**
```typescript
useEffect(() => {
  const handler = () => {
    logger.info("[tasks-panel] Panel hidden");
  };
  eventBus.on("panel-hidden", handler);
  return () => eventBus.off("panel-hidden", handler);
}, []);
```

**Before (clipboard-manager.tsx onFocusChanged):**
```typescript
useEffect(() => {
  const unlistenFocusPromise = getCurrentWindow().onFocusChanged(
    ({ payload: focused }) => {
      if (focused) {
        inputRef.current?.focus();
      }
    }
  );
  return () => {
    unlistenFocusPromise.then((unlisten) => unlisten());
  };
}, []);
```

**After:**
```typescript
// Note: Handler signature changes from ({ payload: focused }) to ({ focused })
useEffect(() => {
  const handler = ({ focused }: { focused: boolean }) => {
    if (focused) {
      inputRef.current?.focus();
    }
  };
  eventBus.on("window:focus-changed", handler);
  return () => eventBus.off("window:focus-changed", handler);
}, []);
```

**Breaking change note**: The `window:focus-changed` event payload changes from `{ payload: boolean }` to `{ focused: boolean }`. All migrated components must update their handler signatures accordingly.

### Step 7: Fix spotlight.tsx task-panel-ready coordination

The `task-panel-ready` listener in spotlight.tsx (lines 267-291) needs special attention:

1. **Spotlight needs incoming bridge**: Currently spotlight only has outgoing bridge. It must also call `setupIncomingBridge()` to receive `task-panel-ready`.

2. **Event flow**: `task-panel-ready` is emitted by task-main.tsx via `emit("task-panel-ready", ...)`. This goes through Tauri to all windows. Spotlight's incoming bridge receives it and forwards to local eventBus.

**Important: task-main.tsx emit pattern**

`task-main.tsx` should continue using Tauri's `emit()` directly for `task-panel-ready`:

```typescript
// task-main.tsx - KEEP using Tauri emit() directly
import { emit } from "@tauri-apps/api/event";

// This is correct! Window coordination events originating from a component
// use Tauri emit() directly. The receiving window's incoming bridge converts
// the Tauri event to eventBus.
emit("task-panel-ready", { threadId });
```

**Why not use `eventBus.emit()`?** The outgoing bridge is for broadcasting local events to OTHER windows. But `task-panel-ready` originates from user action in task-main.tsx - it's not a local event being re-broadcast, it's a direct window-to-window coordination signal. Using `eventBus.emit()` would require task-main to also set up an outgoing bridge that specifically handles this event, which adds unnecessary complexity.

**Rule of thumb**:
- Components that RECEIVE window coordination events: Use `eventBus.on()` (via incoming bridge)
- Components that EMIT window coordination events: Use Tauri's `emit()` directly

This asymmetry is intentional. The ESLint rule should allow `emit()` imports but restrict `listen()` imports.

```typescript
// Before: Race condition with mutable variable
let unlisten: UnlistenFn | null = null;
listen(...).then((fn) => { unlisten = fn; });

// After: Use eventBus with cleanup tracking
const readyPromise = new Promise<void>((resolve) => {
  let resolved = false;

  const handler = (payload: { threadId: string }) => {
    if (payload.threadId === threadId && !resolved) {
      resolved = true;
      clearTimeout(timeout);
      eventBus.off("task-panel-ready", handler);
      resolve();
    }
  };

  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      eventBus.off("task-panel-ready", handler);
      resolve();
    }
  }, 2000);

  eventBus.on("task-panel-ready", handler);
});
```

### Step 8: Update spotlight-main.tsx

Spotlight needs BOTH outgoing AND incoming bridges:

```typescript
// spotlight-main.tsx

async function bootstrap() {
  // Outgoing: for broadcasting events TO other windows
  setupOutgoingBridge();

  // Incoming: for receiving task-panel-ready FROM other windows
  const bridgeCleanup = await setupIncomingBridge();

  // Register cleanup...
  getCurrentWindow().onCloseRequested(() => {
    bridgeCleanup.forEach(fn => fn());
  });

  // ... rest of bootstrap
}
```

---

## Files to Modify

**Bridge & Types:**
1. `src/lib/event-bridge.ts` - Add event categories, HMR support, extend setupIncomingBridge
2. `src/entities/events.ts` - Add LocalEvents type, create union type

**Entry Points (add/update incoming bridge, register onCloseRequested):**
3. `src/simple-task-main.tsx` - Store cleanup, register onCloseRequested
4. `src/task-main.tsx` - Store cleanup, register onCloseRequested
5. `src/tasks-panel-main.tsx` - Store cleanup, register onCloseRequested
6. `src/spotlight-main.tsx` - Add incoming bridge (currently only outgoing), register cleanup
7. `src/clipboard-main.tsx` - Store cleanup, register onCloseRequested
8. `src/error-main.tsx` - Add incoming bridge (currently none), register cleanup

**Components - Migrate listen() to eventBus:**
9. `src/components/tasks-panel/tasks-panel.tsx` - `panel-hidden`, `panel-shown`
10. `src/components/simple-task/use-simple-task-params.ts` - `open-simple-task`
11. `src/components/spotlight/spotlight.tsx` - `task-panel-ready`, `window:focus-changed`
12. `src/components/clipboard/clipboard-manager.tsx` - `clipboard-entry-added`, `window:focus-changed`
13. `src/components/error-panel.tsx` - `show-error`, `panel-hidden`

**Components - Migrate onFocusChanged to eventBus:**
14. `src/components/spotlight/SearchBar.tsx` - `window:focus-changed`

**Configuration:**
15. `eslint.config.js` - Add rule to restrict `listen` imports from `@tauri-apps/api/event`

Example ESLint configuration:
```javascript
// eslint.config.js
import globals from "globals";
import tseslint from "@typescript-eslint/eslint-plugin";

export default [
  // ... other config ...
  {
    // Restrict listen imports in most files
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/lib/event-bridge.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@tauri-apps/api/event",
          importNames: ["listen"],
          message: "Use eventBus.on() from @/lib/event-bridge instead. Only event-bridge.ts may use listen()."
        }]
      }]
    }
  },
  {
    // Allow all imports in event-bridge.ts
    files: ["src/lib/event-bridge.ts"],
    rules: {
      "no-restricted-imports": "off"
    }
  }
];
```

Note: `emit` is NOT restricted because window coordination events still use Tauri's `emit()` directly (see Step 7).

**Documentation (if not already updated):**
16. `docs/patterns/event-bridge.md` - Update pattern documentation

---

## Testing

### Unit Tests

1. **Bridge registration tests** (`src/lib/event-bridge.test.ts`):
   - Test that all expected listeners are registered
   - Test error handling when registration fails
   - Test that `getBridgeStatus()` returns correct counts
   - Test that `getBridgeStatus()` mismatch warning is logged when some listeners fail
   - Test HMR cleanup (call setupIncomingBridge twice, verify no duplicate listeners)
   - Test HMR cleanup errors are logged in dev mode

2. **Type safety tests**:
   - Verify `LOCAL_EVENTS` and `BROADCAST_EVENTS` arrays don't overlap
   - Verify `WINDOW_API_EVENTS` doesn't overlap with `BROADCAST_EVENTS` or `LOCAL_EVENTS`
   - Verify event payloads match expected types
   - Verify `void` payload events work correctly with mitt handlers (no arguments)

3. **Disjointness tests** (all three arrays must be mutually exclusive):
   ```typescript
   // Test all three arrays are disjoint
   expect(intersection(BROADCAST_EVENTS, RUST_PANEL_EVENTS)).toHaveLength(0);
   expect(intersection(BROADCAST_EVENTS, WINDOW_COORDINATION_EVENTS)).toHaveLength(0);
   expect(intersection(BROADCAST_EVENTS, WINDOW_API_EVENTS)).toHaveLength(0);
   expect(intersection(LOCAL_EVENTS, WINDOW_API_EVENTS)).toHaveLength(0);
   ```

### Integration Tests

4. **StrictMode double-mount test**:
   - Create a test component that subscribes to events via eventBus
   - Mount with StrictMode (causes double mount/unmount)
   - Verify no console errors about `listeners[eventId]`
   - Verify cleanup runs without errors

5. **Event routing tests**:
   - Emit a local event, verify only local eventBus receives it
   - Emit a broadcast event, verify it goes through Tauri
   - Verify events don't loop (see below)

6. **Event loopback prevention test**:
   ```typescript
   // Emit a local event, verify it does NOT trigger outgoing bridge
   const tauriEmitSpy = vi.spyOn(tauriEvent, 'emit');
   eventBus.emit("panel-hidden", undefined);

   // Assert: Tauri emit() was NOT called with "app:panel-hidden"
   // Local events should stay local, not leak to outgoing bridge
   expect(tauriEmitSpy).not.toHaveBeenCalledWith(
     expect.stringContaining("panel-hidden"),
     expect.anything()
   );
   ```

### Manual Tests

7. **Panel lifecycle**:
   - Create simple task, verify no console errors
   - Open/close panels rapidly, verify no listener leaks
   - Check Chrome DevTools Memory tab for listener accumulation

8. **Event functionality**:
   - Verify `panel-hidden`/`panel-shown` events still work
   - Verify window focus behavior (spotlight input focus, search bar clear)
   - Verify `task-panel-ready` coordination between spotlight and task panel

9. **Production build**:
   - Build for production (no HMR)
   - Verify events work correctly
   - Check for any timing differences

### Regression Tests

Each migrated component should have explicit verification:

| Component | Events | Verification |
|-----------|--------|--------------|
| `tasks-panel.tsx` | `panel-hidden`, `panel-shown` | Panel state updates correctly |
| `use-simple-task-params.ts` | `open-simple-task` | Task params received |
| `spotlight.tsx` | `task-panel-ready`, `window:focus-changed` | Coordination works, input focuses |
| `clipboard-manager.tsx` | `clipboard-entry-added`, `window:focus-changed` | Clipboard updates, input focuses |
| `error-panel.tsx` | `show-error`, `panel-hidden` | Errors display correctly |
| `SearchBar.tsx` | `window:focus-changed` | Query clears on blur |

---

## Rollout

1. **Phase 1: Bridge extension**
   - Implement event categories in `event-bridge.ts`
   - Add HMR cleanup support
   - Add `getBridgeStatus()` helper with mismatch warning
   - Add runtime disjointness check for all event arrays (including WINDOW_API_EVENTS)
   - Update type definitions in `events.ts`

2. **Phase 2: Spotlight (entry point + component together)**
   - Update `spotlight-main.tsx` to add incoming bridge (currently only outgoing)
   - Update `spotlight.tsx` to use `eventBus.on()` for `task-panel-ready` and `window:focus-changed`
   - These must be done together since the component depends on the entry point's bridge
   - Verify `task-panel-ready` coordination still works

3. **Phase 3: Remaining entry points**
   - Add incoming bridge and cleanup to all other entry points
   - `simple-task-main.tsx`, `task-main.tsx`, `tasks-panel-main.tsx`, `clipboard-main.tsx`, `error-main.tsx`

4. **Phase 4: Migrate components (one at a time, verify each)**
   - Start with `tasks-panel.tsx` (simple, good proof of concept)
   - Then remaining components
   - **Migration checklist for each component:**
     - [ ] Replace `listen()` with `eventBus.on()`
     - [ ] Replace `onFocusChanged()` with `eventBus.on("window:focus-changed", ...)`
     - [ ] Update `window:focus-changed` handlers from `({ payload: focused })` to `({ focused })`
     - [ ] Remove direct Tauri imports (except `emit()` for window coordination)
     - [ ] Verify component works correctly

5. **Phase 5: Enforcement**
   - Add ESLint rule to restrict `listen` imports from `@tauri-apps/api/event`
   - Note: `emit` imports are still allowed for window coordination events
   - Remove unused imports from migrated files
   - Update documentation

6. **Phase 6: Cleanup**
   - Grep for any remaining `listen(` or `onFocusChanged(` outside event-bridge
   - Remove any dead code

---

## Success Criteria

- No components import `listen` from `@tauri-apps/api/event` except event-bridge.ts
- Note: `emit` imports ARE allowed for window coordination events (see Step 7)
- No components import `getCurrentWindow` for event subscriptions (only event-bridge.ts)
- No `UnhandledRejection` errors related to listener cleanup
- All Tauri listeners cleaned up on window close
- Single unified pattern: all events flow through `eventBus.on/off` for receiving
- ESLint rule enforces `listen` import restrictions
- All event arrays (`BROADCAST_EVENTS`, `LOCAL_EVENTS`, `WINDOW_API_EVENTS`) are verified disjoint at runtime
- HMR doesn't cause duplicate listeners in development
- `getBridgeStatus()` logs warning if listener registration count is less than expected

---

## Known Limitations and Pre-existing Issues

### onCloseRequested Async Cleanup Race (Accepted)

The `onCloseRequested` API itself returns a Promise, creating a theoretical race condition:

```typescript
// onCloseRequested returns Promise<UnlistenFn>
getCurrentWindow().onCloseRequested(async () => {
  // cleanup...
});
```

If the window closes during bootstrap (before `onCloseRequested` registration completes), the cleanup handler is never registered. However, this is unavoidable with Tauri's async API and acceptable because:

1. This is a one-time registration during bootstrap, not in React lifecycle
2. The window close during bootstrap is an extremely rare edge case
3. Cleanup is best-effort anyway - OS will reclaim resources

**Mitigation**: The code includes a `cleanupRegistered` flag to prevent double-registration during HMR, and logs any cleanup errors.

### Event Ordering During Bootstrap

The bridge registers listeners in parallel via `Promise.all()`. If an event arrives during hydration (after bridge setup but before `setupEntityListeners()` completes), the handler might expect hydrated stores.

This is a pre-existing issue, not introduced by this plan. Current bootstrap order:
```typescript
await setupIncomingBridge();  // Events can arrive after this
await hydrateEntities();       // But stores aren't ready until here
setupEntityListeners();
```

**Future improvement**: Consider adding a `ready` state that defers event processing until hydration completes.

### Multiple Windows of Same Type

If multiple windows of the same type are open (e.g., two simple-task windows), each has its own eventBus instance. Events from Rust are scoped to the target window by Tauri. This should work correctly but should be tested.

### Window Close During Bootstrap (Accepted)

If a window closes before `onCloseRequested` registration completes, `bridgeCleanup` may be empty or incomplete. This is:
1. A rare edge case (requires closing window within milliseconds of opening)
2. Acceptable because cleanup is best-effort - the OS reclaims resources on window close anyway
3. Already documented in the code with appropriate comments
