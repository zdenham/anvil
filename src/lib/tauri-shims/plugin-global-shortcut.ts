/**
 * Shim: @tauri-apps/plugin-global-shortcut
 *
 * Global shortcuts are not available in web builds.
 */

export async function register(
  _shortcut: string,
  _handler: () => void,
): Promise<void> {
  // no-op
}

export async function unregister(_shortcut: string): Promise<void> {
  // no-op
}

export async function unregisterAll(): Promise<void> {
  // no-op
}

export function isRegistered(_shortcut: string): Promise<boolean> {
  return Promise.resolve(false);
}
