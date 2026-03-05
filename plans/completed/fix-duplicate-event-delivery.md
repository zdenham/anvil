# Fix Duplicate Event Delivery → WebSocket-Only Transport

## Problem

Every `agent:message` event is delivered **twice** to the frontend handler, causing:
- Duplicate events in the event debugger (same event with 2 vs 3 pipeline stamps)
- Duplicate thinking blocks rendered in threads
- Wasted processing of every agent message

## Root Cause

In Tauri mode, the same message reaches the frontend via **two independent transport paths**:

### Path 1: Tauri IPC (2 pipeline stamps)
```
Agent → Unix socket → agent_hub.rs:496 app_handle.emit("agent:message") → tauriListen() callback
```

### Path 2: WebSocket broadcast (3 pipeline stamps)
```
Agent → Unix socket → agent_hub.rs:525 broadcaster.broadcast("agent:message") → handleMessage() → dispatchWsEvent() → wsListeners callback
```

## Strategy: Consolidate to WebSocket-Only

Instead of deduplicating by picking one transport, **consolidate all server→client push events to WebSocket**. This future-proofs for multi-client scenarios (multiple browser windows, remote clients, etc.) where Tauri IPC doesn't exist.

### Transport Audit

| Event | Current Transport | Action |
|-------|------------------|--------|
| `agent:message` | Dual (Tauri IPC + WS) | Drop Tauri IPC emit in Rust |
| `terminal:output/exit/killed` | Dual-path (Tauri cmd → IPC, WS dispatch → WS) | Already WS-capable via dispatch_misc.rs |
| `file-watcher:changed` | Tauri IPC only | **Add WS broadcast in file_watcher.rs** |
| `spotlight-shown`, `open-control-panel`, `show-error` | Tauri IPC only | **Keep as-is** (desktop chrome, see below) |
| `panel-hidden` | Tauri emit_to (window-specific) | **Keep as-is** (desktop chrome) |
| `clipboard-entry-added` | Tauri IPC only | **Keep as-is** (desktop chrome) |
| `app:*` (BROADCAST_EVENTS) | Tauri `emit()` cross-window | **Keep as-is** (see below) |

### What stays on Tauri IPC

**Panel/chrome events** (`RUST_PANEL_EVENTS` + `WINDOW_API_EVENTS`) are inherently desktop-only. They control NSPanel visibility, spotlight focus, error dialogs — concepts that don't exist in multi-client browser mode. These should remain on Tauri IPC.

**Cross-window broadcast** (`BROADCAST_EVENTS` via event-bridge `emit()`) is window↔window coordination within the same machine. This uses Tauri's `emit()` as a broadcast bus between windows. For multi-client, this would eventually become a WS relay or `BroadcastChannel`, but that's a separate concern from server→client push. Keep as-is for now.

### What moves to WS-only

**Server→client push events**: `agent:message`, `terminal:*`, `file-watcher:changed`. These are the events that come from the Rust backend to inform the UI about things happening in agent processes, terminals, and file system. These are the ones that matter for multi-client.

## Fix

### 1. Frontend: `listen()` in `src/lib/events.ts`

Stop dual-registering for **server push events**. In Tauri mode, only register on `wsListeners` (same as browser mode). Tauri IPC registration is only needed for cross-window broadcast and panel events — which go through `event-bridge.ts` directly.

**Before:**
```typescript
export async function listen<T>(event, handler): Promise<UnlistenFn> {
  // Always register on WS push handler
  wsListeners.get(event)!.add(typedHandler);
  if (isTauri()) {
    const unlistenTauri = await tauriListen<T>(event, handler);
    return () => { unlistenWs(); unlistenTauri(); };
  }
  return unlistenWs;
}
```

**After:**
```typescript
export async function listen<T>(event, handler): Promise<UnlistenFn> {
  // WS push handler — canonical transport for all server→client events
  wsListeners.get(event)!.add(typedHandler);
  const unlistenWs = () => { wsListeners.get(event)?.delete(typedHandler); };

  if (isTauri() && isTauriOnlyEvent(event)) {
    // Tauri IPC only for panel/chrome events that don't go through WS
    const { listen: tauriListen } = await import("@tauri-apps/api/event");
    const unlistenTauri = await tauriListen<T>(event, handler);
    return () => { unlistenWs(); unlistenTauri(); };
  }

  return unlistenWs;
}

/** Events that only exist on Tauri IPC (no WS broadcast equivalent) */
function isTauriOnlyEvent(event: string): boolean {
  // Cross-window broadcasts (app: prefix) and panel chrome events
  return event.startsWith("app:") || TAURI_ONLY_EVENTS.has(event);
}

const TAURI_ONLY_EVENTS = new Set([
  "panel-hidden", "panel-shown", "spotlight-shown",
  "open-control-panel", "clipboard-entry-added", "show-error",
]);
```

### 2. Rust: Drop Tauri IPC emit for `agent:message` in `agent_hub.rs`

Remove the `app_handle.emit("agent:message", ...)` calls (lines ~485, ~496). Keep only the `broadcaster.broadcast("agent:message", ...)` calls.

### 3. Rust: Add WS broadcast for `file-watcher:changed` in `file_watcher.rs`

The file watcher currently only emits via `app.emit()`. Add `broadcaster.broadcast()` so browser/WS clients receive file change events. Pattern: pass the broadcaster to the file watcher the same way `dispatch_misc.rs` passes it to terminal functions.

### Files to modify

| File | Change |
|------|--------|
| `src/lib/events.ts` | Conditional Tauri IPC registration (only for panel/chrome/broadcast events) |
| `src-tauri/src/agent_hub.rs` | Remove `app_handle.emit("agent:message")` calls |
| `src-tauri/src/file_watcher.rs` | Add WS broadcast alongside Tauri emit |

### Files NOT modified (and why)

| File | Reason |
|------|--------|
| `src/lib/event-bridge.ts` | Cross-window broadcast stays on Tauri IPC (separate concern) |
| `src-tauri/src/panels.rs` | Desktop chrome events, no multi-client relevance |
| `src-tauri/src/clipboard.rs` | Desktop chrome, no multi-client relevance |
| `src-tauri/src/terminal.rs` | Already dual-path (dispatch_misc.rs handles WS) |

## Phases

- [ ] Fix `listen()` in `src/lib/events.ts` — conditional Tauri IPC registration
- [ ] Remove `app_handle.emit("agent:message")` from `agent_hub.rs`
- [ ] Add WS broadcast to `file_watcher.rs`
- [ ] Verify no other callers depend on dual-registration behavior

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Verification

- Event debugger shows each event exactly once
- Pipeline stamps on captured events consistently have 3 stamps (WS path)
- No duplicate thinking blocks in thread rendering
- Browser mode still works (no regression)
- Panel events (spotlight, control panel) still work in Tauri mode
- Cross-window broadcast (BROADCAST_EVENTS) still works between windows
- File watcher events arrive in both Tauri and browser mode

## Notes

- The `emit()` function in events.ts is only used by `event-bridge.ts` for cross-window broadcast. No other consumer emits events — they all just `listen()`.
- Terminal events are already dual-path: `dispatch_misc.rs` passes a broadcaster closure when called via WS, while Tauri commands use `app.emit()`. No changes needed.
- Long term, cross-window broadcast could move to `BroadcastChannel` API (web-native) or a WS relay endpoint. That's a separate plan.
- The WS broadcaster channel has capacity 1024. Slow clients drop events — acceptable for now but worth monitoring.
