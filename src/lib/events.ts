/**
 * Event Transport Wrapper
 *
 * All events flow through WebSocket:
 * - Server→client push events via WS broadcast
 * - Cross-window broadcast events via WS relay
 *
 * Import this instead of `@tauri-apps/api/event` everywhere.
 */

import { setEventDispatcher, relayEvent } from "./invoke";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Matches Tauri's event callback shape */
export type EventHandler<T> = (event: { payload: T }) => void;

/** Matches Tauri's UnlistenFn */
export type UnlistenFn = () => void;

// ═══════════════════════════════════════════════════════════════════════════
// WS Event Registry
// ═══════════════════════════════════════════════════════════════════════════

const wsListeners = new Map<string, Set<EventHandler<unknown>>>();

/** Dispatches a server push event to registered WS listeners */
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
 * All events (server→client push and cross-window relay) arrive via WS.
 */
export async function listen<T>(
  event: string,
  handler: EventHandler<T>,
): Promise<UnlistenFn> {
  if (!wsListeners.has(event)) {
    wsListeners.set(event, new Set());
  }
  const typedHandler = handler as EventHandler<unknown>;
  wsListeners.get(event)!.add(typedHandler);
  return () => {
    wsListeners.get(event)?.delete(typedHandler);
  };
}

/**
 * Emit an event (cross-window broadcast via WS relay).
 * The server rebroadcasts to all connected clients.
 */
export async function emit(event: string, payload?: unknown): Promise<void> {
  relayEvent(event, payload);
}
