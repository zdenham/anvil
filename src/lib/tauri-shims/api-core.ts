/**
 * Shim: @tauri-apps/api/core
 *
 * In web builds, invoke() is handled by src/lib/invoke.ts (WS transport).
 * This shim exists solely to satisfy import resolution for files that
 * import directly from @tauri-apps/api/core.
 */

export async function invoke<T>(_cmd: string, _args?: Record<string, unknown>): Promise<T> {
  throw new Error("Tauri IPC not available in web build — use @/lib/invoke instead");
}

export function convertFileSrc(path: string, _protocol?: string): string {
  return `http://127.0.0.1:9600/files?path=${encodeURIComponent(path)}`;
}
