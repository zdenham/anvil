# WebSocket-Only Event Transport

Migrate all Rust `emit()`/`emit_to()` calls and cross-window broadcast to WebSocket, eliminating `@tauri-apps/api/event` entirely.

## Complete Rust Emit Inventory

| Event | File:Line | Method | Category |
|-------|-----------|--------|----------|
| `agent:message` | agent_hub.rs:485,496 | `app_handle.emit()` | Server→Client |
| `agent:message` | agent_hub.rs:489,525 | `broadcaster.broadcast()` | Server→Client |
| `terminal:output/exit` | terminal.rs:194 | callback `app.emit()` | Server→Client |
| `terminal:killed` | terminal.rs:299,353 | callback `app.emit()` | Server→Client |
| terminal events | dispatch_misc.rs:194-216 | callback `broadcaster.broadcast()` | Server→Client |
| `file-watcher:changed` | file_watcher.rs:93 | `app.emit()` | Server→Client |
| `log-event` | logging/mod.rs:202 | `handle.emit()` | Server→Client |
| `set-content-pane-view` | lib.rs:405 | `window.emit()` | Rust→Window |
| `navigate` | lib.rs:829, tray.rs:81 | `window.emit()` | Rust→Window |
| `spotlight-shown` | panels.rs:341,371 | `app.emit()` | Panel chrome |
| `open-control-panel` | panels.rs:892, lib.rs:466 | `app.emit()` | Panel chrome |
| `show-error` | panels.rs:660 | `app.emit()` | Panel chrome |
| `clipboard-entry-added` | clipboard.rs:125 | `app.emit()` | Panel chrome |
| `panel-hidden` | panels.rs:250,316,622,847,954 | `app.emit_to(LABEL)` | Panel chrome (targeted) |
| `app:*` (BROADCAST_EVENTS) | event-bridge.ts | `emit()` → Tauri `emit()` | Cross-window |

## Frontend Listener Inventory

| Event | File | via |
|-------|------|-----|
| `terminal:output/exit/killed` | entities/terminal-sessions/listeners.ts | `listen()` |
| `file-watcher:changed` | lib/file-watcher-client.ts | `listen()` |
| `log-event` | entities/logs/service.ts | `listen()` |
| `set-content-pane-view` | components/main-window/main-window-layout.tsx | `listen()` |
| `navigate` | components/main-window/main-window-layout.tsx | `listen()` |
| `app:*` broadcast | lib/event-bridge.ts `setupIncomingBridge` | `listen()` |
| Panel events | lib/event-bridge.ts `registerTauriToMitt` | `listen()` |
| `window:focus-changed` | lib/event-bridge.ts | `getCurrentWindow().onFocusChanged()` |

## Architecture

### Current: Dual Transport

```
Rust emit()  ──→  Tauri IPC  ──→  tauriListen() callback
                                        ↓
                               handler (called once)
                                        ↑
Rust broadcast() → WS push → dispatchWsEvent() → wsListeners callback
```

Both paths registered in `listen()` → **duplicate delivery**.

### Target: WS-Only

```
Rust broadcaster.broadcast()  ──→  WS push  ──→  dispatchWsEvent()  ──→  wsListeners  ──→  handler

Window A eventBus  ──→  WS relay msg  ──→  server rebroadcasts  ──→  all other clients
```

All events flow through WebSocket. `@tauri-apps/api/event` is removed entirely.

## Phases

- [x] Phase 1: Server→Client push events (WS-only)
- [x] Phase 2: Rust→Window command events via WS broadcast
- [x] Phase 3: Cross-window relay protocol
- [x] Phase 4: Remove `@tauri-apps/api/event` entirely

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Server→Client Push Events

Move data events from Rust to WS broadcast only.

### Rust changes

**agent_hub.rs** — Remove `app_handle.emit("agent:message")` at lines 485, 496. Keep `broadcaster.broadcast()` at 489, 525.

**file_watcher.rs** — Add `broadcaster.broadcast("file-watcher:changed", payload)` alongside or replacing `app.emit()`. Pass `EventBroadcaster` to file watcher via the same pattern as `dispatch_misc.rs` (inject broadcaster into the callback closure).

**logging/mod.rs** — Add `broadcaster.broadcast("log-event", payload)` alongside or replacing `handle.emit()`. Pass `EventBroadcaster` to the logger.

### Frontend changes

**events.ts `listen()`** — Stop registering Tauri IPC listener. All events come through wsListeners via WS push. The function becomes:

```typescript
export async function listen<T>(event: string, handler: EventHandler<T>): Promise<UnlistenFn> {
  if (!wsListeners.has(event)) wsListeners.set(event, new Set());
  const typedHandler = handler as EventHandler<unknown>;
  wsListeners.get(event)!.add(typedHandler);
  return () => { wsListeners.get(event)?.delete(typedHandler); };
}
```

No more `isTauri()` check, no more dynamic import of `@tauri-apps/api/event`. Pure WS.

### Files

| File | Change |
|------|--------|
| `src-tauri/src/agent_hub.rs` | Remove `app_handle.emit()` calls |
| `src-tauri/src/file_watcher.rs` | Add WS broadcast, inject EventBroadcaster |
| `src-tauri/src/logging/mod.rs` | Add WS broadcast, inject EventBroadcaster |
| `src/lib/events.ts` | Remove Tauri IPC listener registration from `listen()` |

## Phase 2: Rust→Window Command Events

These are events Rust sends to specific windows to trigger UI actions.

### Rust changes

**panels.rs** — Add `broadcaster.broadcast()` for:
- `spotlight-shown` (lines 341, 371)
- `open-control-panel` (line 892)
- `show-error` (line 660)
- `clipboard-entry-added` (line 125 in clipboard.rs)
- `panel-hidden` (lines 250, 316, 622, 847, 954) — broadcast with `targetWindow` field in payload for client-side filtering

**lib.rs** — Add `broadcaster.broadcast()` for:
- `set-content-pane-view` (line 405) — add `targetWindow` field
- `navigate` (line 829) — add `targetWindow` field
- `open-control-panel` (line 466)

**tray.rs** — Add `broadcaster.broadcast()` for:
- `navigate` (line 81) — add `targetWindow` field

### Frontend changes

For targeted events (`panel-hidden`, `set-content-pane-view`, `navigate`), the handler needs to filter by window label:

```typescript
listen("panel-hidden", (event) => {
  if (event.payload.targetWindow && event.payload.targetWindow !== getWindowLabel()) return;
  // handle
});
```

This filtering would live in `event-bridge.ts` `registerTauriToMitt()`, or be handled per-listener.

### Files

| File | Change |
|------|--------|
| `src-tauri/src/panels.rs` | Add `broadcaster.broadcast()` for all panel events |
| `src-tauri/src/clipboard.rs` | Add `broadcaster.broadcast("clipboard-entry-added")` |
| `src-tauri/src/lib.rs` | Add `broadcaster.broadcast()` for navigate + content pane |
| `src-tauri/src/tray.rs` | Add `broadcaster.broadcast()` for navigate |
| `src/lib/event-bridge.ts` | Add targetWindow filtering for window-specific events |

### EventBroadcaster access pattern

Several Rust modules need access to the `EventBroadcaster`. Options:
1. **AppState** — store `Arc<RwLock<Option<EventBroadcaster>>>` in Tauri managed state (cleanest for modules that have `app` handle)
2. **Constructor injection** — pass broadcaster reference to each module at setup time (already done for agent_hub)

Recommend: store broadcaster in Tauri AppState so any module with an `app` handle can access it via `app.state::<WsBroadcaster>()`.

## Phase 3: Cross-Window Relay Protocol

Replace Tauri `emit()` for cross-window broadcast with a WS relay.

### WS protocol addition

New message type: **relay** (client→server→all clients)

```json
// Client sends:
{ "relay": true, "event": "app:agent:state", "payload": { "_source": "main", ... } }

// Server broadcasts to ALL connected clients:
{ "event": "app:agent:state", "payload": { "_source": "main", ... } }
```

Echo prevention via `_source` field already exists in event-bridge.ts — no change needed.

### Rust changes

**ws_server handler** — In the WS message handler (where request/response is parsed), add relay handling:

```rust
if let Some(true) = msg.get("relay").and_then(|v| v.as_bool()) {
    if let (Some(event), Some(payload)) = (msg.get("event"), msg.get("payload")) {
        broadcaster.broadcast(event.as_str().unwrap(), payload.clone());
    }
    return; // No response needed
}
```

### Frontend changes

**events.ts `emit()`** — Replace Tauri emit with WS relay:

```typescript
export async function emit(event: string, payload?: unknown): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ relay: true, event, payload }));
    return;
  }
  // WS not connected — event is dropped (same as current browser-mode behavior)
}
```

This requires `emit()` to have access to the WS socket. Either:
- Import from invoke.ts: `export function getWs(): WebSocket | null`
- Or move relay into invoke.ts: `export function relayEvent(event: string, payload: unknown): void`

The `relayEvent` approach is cleaner — keeps WS details in invoke.ts:

```typescript
// invoke.ts
export function relayEvent(event: string, payload: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ relay: true, event, payload }));
  }
}

// events.ts
import { setEventDispatcher, relayEvent } from "./invoke";

export async function emit(event: string, payload?: unknown): Promise<void> {
  relayEvent(event, payload);
}
```

### Files

| File | Change |
|------|--------|
| `src-tauri/src/ws_server/` (handler) | Add relay message handling |
| `src/lib/invoke.ts` | Add `relayEvent()` function |
| `src/lib/events.ts` | Replace Tauri emit with `relayEvent()` |

## Phase 4: Remove `@tauri-apps/api/event`

With all events flowing through WS, remove the Tauri event system entirely.

### Frontend changes

**events.ts** — Remove all `@tauri-apps/api/event` imports and `isTauri()` checks. Both `listen()` and `emit()` become pure WS operations.

**eslint.config.js** — The existing restriction rule (`@tauri-apps/api/event` → use `@/lib/events`) can be tightened to fully ban the import.

**test mocks** — `src/test/setup-ui.ts` mocks `@tauri-apps/api/event` — this mock can be removed.

### Rust changes

Remove all `app.emit()`, `app.emit_to()`, `app_handle.emit()`, and `window.emit()` calls that were replaced by `broadcaster.broadcast()` in phases 1-2.

### Files

| File | Change |
|------|--------|
| `src/lib/events.ts` | Remove `isTauri()`, remove `@tauri-apps/api/event` import |
| `src/lib/event-bridge.ts` | Remove Tauri-specific comments, simplify |
| `eslint.config.js` | Tighten ban on `@tauri-apps/api/event` |
| `src/test/setup-ui.ts` | Remove `@tauri-apps/api/event` mock |
| All Rust files from phases 1-2 | Remove `app.emit()` / `emit_to()` calls |

## Not In Scope

**`getCurrentWindow()` / Tauri window APIs** — `onFocusChanged()`, `close()`, `setSize()`, drag handling. These are window management APIs, not event emitters. They stay as Tauri APIs (with browser-stubs fallback). Separate concern.

**`invoke()` Tauri IPC** — Native commands (panel show/hide, hotkey registration, accessibility) still route through Tauri IPC via `invoke.ts`. Data commands already prefer WS. Not an emit concern.

## Tradeoff: Reliability During WS Reconnect

Currently, Tauri IPC is always available (in-process). WS can disconnect (crash, reconnect delay). Moving panel chrome events (spotlight-shown, panel-hidden) to WS-only means they won't fire during WS reconnect.

**Mitigation options:**
1. **Accept it** — WS reconnect is fast (1-10s backoff), panel events are non-critical during brief outages
2. **Queue and replay** — buffer events during disconnect, replay on reconnect (complexity)
3. **Dual-emit for critical panel events only** — keep Tauri IPC for the 6 panel events as fallback

Recommend option 1 for now. If reliability becomes an issue, option 3 is the minimal fallback.

## Verification

- Event debugger shows no duplicate events
- All events have consistent pipeline stamp count (WS path)
- Panel events (spotlight, control panel, error) work correctly
- Cross-window broadcast (agent:state, thread updates) works between windows
- Browser mode (no Tauri) works identically
- `@tauri-apps/api/event` has zero imports in non-plan files
- Log events stream to logs panel correctly
- File watcher events trigger refresh correctly
- Terminal output streams without gaps
- Navigate from tray/menu works
