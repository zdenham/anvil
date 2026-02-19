# 03 — DrainManager + Hub Client Extension

## Summary

Build the TypeScript side of the drain pipeline: a `DrainManager` class that provides type-safe event emission, and extend the hub client/types to support the `"drain"` message type. This is the API that instrumentation code (04) calls.

## Phases

- [x] Add `DrainMessage` to `agents/src/lib/hub/types.ts`
- [x] Add `sendDrain()` to `agents/src/lib/hub/client.ts`
- [x] Create `agents/src/lib/drain-manager.ts`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Modified File: `agents/src/lib/hub/types.ts`

Add after `RelayMessage` (line 37):

```typescript
export interface DrainMessage extends SocketMessage {
  type: "drain";
  event: string;
  properties: Record<string, string | number | boolean>;
}
```

No changes to `TauriToAgentMessage` — drain is agent→Tauri only, no responses.

---

## Modified File: `agents/src/lib/hub/client.ts`

Add after `relay()` method (line 60):

```typescript
/** Send a drain analytics event through the hub to SQLite storage */
sendDrain(event: string, properties: Record<string, string | number | boolean>): void {
  this.send({ type: "drain", event, properties });
}
```

Same fire-and-forget pattern as `sendLog()` and `sendEvent()`. No acknowledgement expected.

---

## New File: `agents/src/lib/drain-manager.ts`

### Purpose

Type-safe wrapper around `HubClient.sendDrain()`. Provides:
1. Type-safe `emit()` method that maps event names to their property schemas
2. Graceful no-op when hub is not connected (agents without hub still work)
3. Timing helpers (`startTimer` / `endTimer`) for duration tracking

### Implementation

```typescript
import type { HubClient } from "./hub/client.js";
import type { DrainEventNameType, DrainEventPayloads } from "@core/types/drain-events.js";

export class DrainManager {
  private timers = new Map<string, number>();

  constructor(private hub: HubClient | null) {}

  /**
   * Emit a typed drain event. No-op if hub is not connected.
   */
  emit<E extends DrainEventNameType>(
    event: E,
    properties: DrainEventPayloads[E],
  ): void {
    if (!this.hub?.isConnected) return;
    // Flatten to Record<string, string | number | boolean>
    // (already flat by schema design, but satisfies the type)
    const flat: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(properties)) {
      if (v !== undefined && v !== null) {
        flat[k] = v as string | number | boolean;
      }
    }
    this.hub.sendDrain(event, flat);
  }

  /**
   * Start a timer for a keyed operation (e.g. tool use ID).
   * Returns the start timestamp for immediate use.
   */
  startTimer(key: string): number {
    const now = Date.now();
    this.timers.set(key, now);
    return now;
  }

  /**
   * End a timer and return elapsed milliseconds.
   * Returns 0 if timer was never started (defensive).
   */
  endTimer(key: string): number {
    const start = this.timers.get(key);
    this.timers.delete(key);
    if (!start) return 0;
    return Date.now() - start;
  }
}
```

### Instantiation

Created in `runAgentLoop()` in `shared.ts`, passed to hooks and message handler:

```typescript
const drainManager = new DrainManager(getHubClient());
```

### Design decisions

- **No buffering** — events are already buffered by the Rust SQLite worker. TS side is fire-and-forget.
- **No schema validation at emit time** — TypeScript compiler enforces correct properties via `DrainEventPayloads`. Runtime validation happens at the Zod schema level only if needed for debugging.
- **Flat properties only** — the `DrainEventPayloads` interface guarantees all values are `string | number | boolean`. Arrays are encoded as JSON strings at the call site (e.g. `filesModified: JSON.stringify([...])` ).
- **Timer helper** — avoids `Map<string, number>` duplication across hooks. Tool use IDs are the natural timer keys.
