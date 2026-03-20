/**
 * Shim: @tauri-apps/api/event
 *
 * Events are handled by src/lib/events.ts (WS transport).
 * This shim satisfies import resolution only.
 */

type EventHandler<T> = (event: { payload: T }) => void;
type UnlistenFn = () => void;

export async function listen<T>(
  _event: string,
  _handler: EventHandler<T>,
): Promise<UnlistenFn> {
  return () => {};
}

export async function emit(_event: string, _payload?: unknown): Promise<void> {
  // no-op
}
