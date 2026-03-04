/**
 * Runtime Detection
 *
 * Detects whether the app is running inside a Tauri WebView
 * or in a regular browser (Chrome, Playwright, etc.).
 *
 * Used by invoke.ts, events.ts, and browser-stubs.ts to choose
 * the correct transport or API implementation.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
