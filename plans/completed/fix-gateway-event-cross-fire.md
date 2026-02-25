# Fix: GATEWAY_EVENT handler receives PR_UPDATED payloads

## Bug Summary

The `GATEWAY_EVENT` handler in `src/entities/gateway-channels/listeners.ts` is receiving payloads from `PR_UPDATED` events (`{ prId: "..." }`) instead of `GatewayEvent` objects (which have `type`, `channelId`, `payload` fields). This causes the guard at line 27 to fire and log the diagnostic error.

The stack trace proves the call chain:
```
pullRequestService.update() → eventBus.emit(PR_UPDATED) → mitt.emit → gateway listener
```

## Root Cause Analysis

Mitt stores handlers in a `Map<string, Function[]>`. When `eventBus.on("gateway:event", handler)` is called, the handler is stored under key `"gateway:event"`. When `eventBus.emit("pr:updated", payload)` is called, mitt looks up handlers under key `"pr:updated"`.

**The gateway handler is stored under the `"pr:updated"` key**, meaning at registration time, `EventName.GATEWAY_EVENT` resolved to `"pr:updated"` instead of `"gateway:event"`.

The error fires **twice** per PR update (two identical log entries), indicating the handler was registered twice under the wrong key.

### Most likely cause: Vite HMR module re-execution

The `setupEntityListeners()` function in `src/entities/index.ts` has **no idempotency guard**. When Vite HMR triggers a module re-execution:

1. `setupGatewayChannelListeners()` re-executes
2. During HMR, the `EventName` import may resolve from a **stale or partially-updated module snapshot** where `GATEWAY_EVENT` maps to a different string
3. The handler gets registered on the wrong key in mitt's Map
4. Old handlers from the previous module version may also persist (no cleanup)

Supporting evidence:
- The error fires exactly twice (suggests double registration)
- This was observed on `localhost:1421` (Vite dev server, HMR-enabled)
- There is zero cleanup logic for mitt handlers on HMR in any listener setup function

## Phases

- [x] Add idempotency guards and HMR cleanup to listener setup functions
- [x] Add runtime validation in `setupGatewayChannelListeners` to verify the event name
- [x] Remove debug logging scaffolding from gateway listeners

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add idempotency guards and HMR cleanup

The core fix. Prevent double-registration and clean up stale handlers on HMR.

### 1a. `setupGatewayChannelListeners` — add off + on pattern

**File:** `src/entities/gateway-channels/listeners.ts`

Store the handler reference in a module-level variable. Before registering, call `eventBus.off()` to remove any previous handler. This makes the function safe to call multiple times (idempotent).

```ts
let gatewayEventHandler: ((event: GatewayEvent) => void) | null = null;

export function setupGatewayChannelListeners(): void {
  // Clean up previous handler (HMR safety)
  if (gatewayEventHandler) {
    eventBus.off(EventName.GATEWAY_EVENT, gatewayEventHandler);
  }

  gatewayEventHandler = (event: GatewayEvent) => {
    // ... existing handler logic (sans debug scaffolding)
  };

  eventBus.on(EventName.GATEWAY_EVENT, gatewayEventHandler);
}
```

### 1b. `setupPullRequestListeners` — same pattern

**File:** `src/entities/pull-requests/listeners.ts`

Apply the same off+on pattern. Store handler references at module level and clean up before re-registering.

### 1c. `setupEntityListeners` — add initialization guard

**File:** `src/entities/index.ts`

Add a module-level `let listenersInitialized = false` guard to `setupEntityListeners()`. If already initialized, log a warning and call cleanup before re-registering (or skip entirely). This prevents the double-call scenario.

## Phase 2: Add runtime validation

**File:** `src/entities/gateway-channels/listeners.ts`

Add a dev-mode assertion at registration time to verify the key mitt is using:

```ts
if (import.meta.env.DEV) {
  // Verify EventName.GATEWAY_EVENT resolves correctly at registration time
  const expectedKey = "gateway:event";
  if (EventName.GATEWAY_EVENT !== expectedKey) {
    logger.error(
      `[GatewayChannelListener] BUG: EventName.GATEWAY_EVENT is "${EventName.GATEWAY_EVENT}", expected "${expectedKey}"`,
    );
  }
}
```

This will immediately flag the issue if HMR causes a stale import.

## Phase 3: Remove debug logging scaffolding

**File:** `src/entities/gateway-channels/listeners.ts`

The current handler has extensive diagnostic logging (lines 16-25, 28-37) that was added to investigate this bug. Once the fix is in place:

1. Remove the verbose `logger.info` that logs every `GATEWAY_EVENT` (lines 16-25)
2. Simplify the guard clause — keep a terse `logger.warn` for non-GatewayEvent payloads (as a safety net), but remove the full diagnostic stack trace capture
3. The handler should be clean: guard → route github events → done
