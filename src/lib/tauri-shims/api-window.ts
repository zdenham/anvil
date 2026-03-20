/**
 * Shim: @tauri-apps/api/window
 *
 * Provides no-op stubs for Tauri window APIs.
 * The real getCurrentWindow() is handled by browser-stubs.ts.
 */

const noopWindow = {
  label: "browser",
  setSize: async () => {},
  startDragging: async () => {},
  isFullscreen: async () => false,
  onResized: async () => () => {},
  onFocusChanged: async () => () => {},
  onDragDropEvent: async () => () => {},
  close: async () => {},
  show: async () => {},
  hide: async () => {},
};

export function getCurrentWindow() {
  return noopWindow;
}
