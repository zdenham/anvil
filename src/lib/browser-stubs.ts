/**
 * Browser Stubs for Tauri APIs
 *
 * Provides browser-compatible replacements for Tauri-specific APIs.
 * In Tauri: delegates to real Tauri APIs via dynamic import.
 * In browser: returns no-op stubs or sensible defaults.
 *
 * Used for: getCurrentWindow, LogicalSize, convertFileSrc, getVersion,
 * and path utilities (join, resolveResource, dirname).
 */

import { isTauri } from "./runtime";

const FILE_SERVER_URL = "http://127.0.0.1:9600/files";

// ═══════════════════════════════════════════════════════════════════════════
// Eager Module Loading
// ═══════════════════════════════════════════════════════════════════════════

// In Tauri, eagerly load the window and core modules at import time.
// These are bundled by Vite and available synchronously after first load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _windowMod: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _coreMod: any = null;

if (isTauri()) {
  // Kick off dynamic imports eagerly — they resolve from Vite's bundle (fast)
  import("@tauri-apps/api/window").then((mod) => { _windowMod = mod; });
  import("@tauri-apps/api/core").then((mod) => { _coreMod = mod; });
}

// ═══════════════════════════════════════════════════════════════════════════
// Window API Stubs
// ═══════════════════════════════════════════════════════════════════════════

type UnlistenFn = () => void;

interface WindowStub {
  label: string;
  setSize: (size: unknown) => Promise<void>;
  startDragging: () => Promise<void>;
  isFullscreen: () => Promise<boolean>;
  onResized: (handler: (event: unknown) => void) => Promise<UnlistenFn>;
  onFocusChanged: (
    handler: (event: { payload: boolean }) => void,
  ) => Promise<UnlistenFn>;
  close: () => Promise<void>;
  show: () => Promise<void>;
  hide: () => Promise<void>;
}

const noopWindow: WindowStub = {
  label: "browser",
  setSize: async () => {},
  startDragging: async () => {},
  isFullscreen: async () => false,
  onResized: async () => () => {},
  onFocusChanged: async () => () => {},
  close: async () => {},
  show: async () => {},
  hide: async () => {},
};

/**
 * Returns the current Tauri window or a no-op stub in browser.
 * In Tauri mode, the module is loaded eagerly at import time.
 * If called before the eager load resolves (very unlikely), returns
 * the noop stub — the Tauri window APIs are only used after React mounts.
 */
export function getCurrentWindow(): WindowStub {
  if (!isTauri()) return noopWindow;
  if (_windowMod) return _windowMod.getCurrentWindow() as WindowStub;
  return noopWindow;
}

/** LogicalSize matching Tauri's constructor signature */
export class LogicalSize {
  type = "Logical" as const;
  constructor(
    public width: number,
    public height: number,
  ) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// Asset URL Conversion
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Converts a filesystem path to a URL the browser can load.
 * In Tauri: uses Tauri's asset protocol.
 * In browser: routes through the HTTP file server on :9600.
 */
export function convertFileSrc(path: string): string {
  if (isTauri() && _coreMod) {
    return _coreMod.convertFileSrc(path) as string;
  }
  return `${FILE_SERVER_URL}?path=${encodeURIComponent(path)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// App API Stubs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns the app version.
 * In Tauri: delegates to @tauri-apps/api/app.
 * In browser: returns "dev".
 */
export async function getVersion(): Promise<string> {
  if (isTauri()) {
    const { getVersion: tauriGetVersion } = await import(
      "@tauri-apps/api/app"
    );
    return tauriGetVersion();
  }
  return "dev";
}

// ═══════════════════════════════════════════════════════════════════════════
// Path Utility Stubs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Join path segments.
 * In Tauri: async, delegates to Rust.
 * In browser: simple posix-style join.
 */
export async function join(...paths: string[]): Promise<string> {
  if (isTauri()) {
    const pathMod = await import("@tauri-apps/api/path");
    return pathMod.join(...paths);
  }
  return paths
    .map((s) => s.replace(/\/+$/, ""))
    .filter((s) => s.length > 0)
    .join("/");
}

/**
 * Resolve a resource path.
 * In Tauri: delegates to Tauri's resource resolver.
 * In browser: returns the path unchanged.
 */
export async function resolveResource(path: string): Promise<string> {
  if (isTauri()) {
    const pathMod = await import("@tauri-apps/api/path");
    return pathMod.resolveResource(path);
  }
  return path;
}

/**
 * Get the directory name of a path.
 * In Tauri: async, delegates to Rust.
 * In browser: simple posix-style dirname.
 */
export async function dirname(path: string): Promise<string> {
  if (isTauri()) {
    const pathMod = await import("@tauri-apps/api/path");
    return pathMod.dirname(path);
  }
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "." : path.substring(0, lastSlash);
}
