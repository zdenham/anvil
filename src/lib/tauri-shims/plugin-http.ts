/**
 * Shim: @tauri-apps/plugin-http
 *
 * Re-exports the native fetch API. Tauri's plugin-http provides a `fetch`
 * that bypasses CORS — in web builds, we use the browser's native fetch
 * and rely on the sidecar to proxy if needed.
 */

export const fetch = globalThis.fetch.bind(globalThis);
