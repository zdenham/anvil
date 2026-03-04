/**
 * Event Transport Wrapper
 *
 * Drop-in replacement for `listen`, `emit`, and `UnlistenFn`
 * from `@tauri-apps/api/event`.
 *
 * Routes:
 * - Tauri WebView: registers on both Tauri IPC events and WS push events
 * - Browser: registers handlers for WebSocket push events
 *
 * Import this instead of `@tauri-apps/api/event` everywhere.
 */

import { isTauri } from "./runtime";
import { setEventDispatcher } from "./invoke";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Matches Tauri's event callback shape */
export type EventHandler<T> = (event: { payload: T }) => void;

/** Matches Tauri's UnlistenFn */
export type UnlistenFn = () => void;

// ═══════════════════════════════════════════════════════════════════════════
// Browser-side event registry (used when not in Tauri)
// ═══════════════════════════════════════════════════════════════════════════

const wsListeners = new Map<string, Set<EventHandler<unknown>>>();

/** Dispatches a server push event to registered browser listeners */
function dispatchWsEvent(event: string, payload: unknown): void {
  const handlers = wsListeners.get(event);
  if (!handlers) return;

  for (const handler of handlers) {
    try {
      handler({ payload });
    } catch {
      // Don't let one handler failure break others
    }
  }
}

// Register this dispatcher with invoke.ts so it can route push messages
setEventDispatcher(dispatchWsEvent);

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Listen for an event. Returns a function to stop listening.
 *
 * Always registers on the WS push handler so events arriving via either
 * transport (Tauri IPC or WebSocket broadcast) are received. In Tauri mode
 * we also register on the Tauri event system for commands that go through
 * Tauri IPC (whose events come back via `app.emit()`).
 */
export async function listen<T>(
  event: string,
  handler: EventHandler<T>,
): Promise<UnlistenFn> {
  // Always register on WS push handler — commands routed through WS
  // emit events via broadcaster.broadcast() which arrive here.
  if (!wsListeners.has(event)) {
    wsListeners.set(event, new Set());
  }
  const typedHandler = handler as EventHandler<unknown>;
  wsListeners.get(event)!.add(typedHandler);
  const unlistenWs = () => {
    wsListeners.get(event)?.delete(typedHandler);
  };

  if (isTauri()) {
    const { listen: tauriListen } = await import("@tauri-apps/api/event");
    const unlistenTauri = await tauriListen<T>(event, handler);
    return () => {
      unlistenWs();
      unlistenTauri();
    };
  }

  return unlistenWs;
}

/**
 * Emit an event.
 * In Tauri: delegates to Tauri event system (cross-window broadcast).
 * In browser: no-op (single window, no cross-window coordination needed).
 */
export async function emit(event: string, payload?: unknown): Promise<void> {
  if (isTauri()) {
    const { emit: tauriEmit } = await import("@tauri-apps/api/event");
    return tauriEmit(event, payload);
  }
  // Browser: no-op for now. Cross-window events are irrelevant
  // in single-window browser mode. WS push events are dispatched
  // by the server, not emitted by the client.
}
