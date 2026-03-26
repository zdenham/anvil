/**
 * Transport Wrapper for Tauri invoke()
 *
 * Provides a drop-in replacement for `invoke()` from `@tauri-apps/api/core`.
 * Routes commands through either:
 *   - WebSocket (localhost:9600) for data commands
 *   - Tauri IPC for native commands (window, panel, hotkey, etc.)
 *   - No-op defaults for native commands when running in browser
 *
 * Import this instead of `@tauri-apps/api/core` everywhere.
 */

import { isTauri } from "./runtime";

const DEFAULT_WS_PORT = __ANVIL_WS_PORT__;
const REQUEST_TIMEOUT_MS = 30_000;

/** Last-resolved port for getWsPort() consumers (agent-service, debugger). */
let lastResolvedPort: number = DEFAULT_WS_PORT;

/** Last-resolved auth token for getWsToken() consumers (agent-service, debugger). */
let resolvedToken: string | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// Native Commands (Tauri IPC only, no-op in browser)
// ═══════════════════════════════════════════════════════════════════════════

const NATIVE_COMMANDS = new Set([
  "show_main_window",
  "hide_main_window",
  "show_main_window_with_view",
  "open_control_panel",
  "hide_control_panel",
  "show_control_panel",
  "pin_control_panel",
  "is_panel_visible",
  "is_any_panel_visible",
  "show_control_panel_with_view",
  "close_control_panel_window",
  "focus_control_panel",
  "get_pending_control_panel",
  "show_spotlight",
  "hide_spotlight",
  "resize_spotlight",
  "register_hotkey",
  "save_hotkey",
  "get_saved_hotkey",
  "save_clipboard_hotkey",
  "get_saved_clipboard_hotkey",
  "get_spotlight_enabled",
  "set_spotlight_enabled",
  "check_accessibility_permission",
  "request_accessibility_permission",
  "check_accessibility_permission_with_prompt",
  "get_accessibility_status",
  "kill_system_settings",
  "disable_system_spotlight_shortcut",
  "is_system_spotlight_enabled",
  "show_error_panel",
  "hide_error_panel",
  "get_pending_error",
  "search_applications",
  "open_application",
  "open_directory_in_app",
  "restart_app",
  "complete_onboarding",
  "is_onboarded",
  "get_clipboard_history",
  "get_clipboard_content",
  "paste_clipboard_entry",
  "hide_clipboard_manager",
  "run_update",
  "get_ws_port",
  "get_ws_token",
]);

/** Sensible defaults when native commands are called from browser */
const NATIVE_DEFAULTS: Record<string, unknown> = {
  is_panel_visible: false,
  is_any_panel_visible: false,
  is_system_spotlight_enabled: false,
  is_onboarded: true,
  get_saved_hotkey: null,
  get_saved_clipboard_hotkey: null,
  get_spotlight_enabled: false,
  check_accessibility_permission: true,
  check_accessibility_permission_with_prompt: true,
  get_accessibility_status: {
    has_permission: true,
    app_name: null,
    exe_path: null,
    bundle_id: null,
  },
  get_pending_error: null,
  get_pending_control_panel: null,
  search_applications: [],
  get_clipboard_history: [],
  get_clipboard_content: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket State
// ═══════════════════════════════════════════════════════════════════════════

let ws: WebSocket | null = null;
let requestId = 0;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectingPromise: Promise<void> | null = null;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, PendingRequest>();

// ═══════════════════════════════════════════════════════════════════════════
// Event dispatch hook (set by events.ts to receive server push messages)
// ═══════════════════════════════════════════════════════════════════════════

type EventDispatcher = (event: string, payload: unknown) => void;
let eventDispatcher: EventDispatcher | null = null;

/** Called by events.ts to register its dispatch function */
export function setEventDispatcher(dispatcher: EventDispatcher): void {
  eventDispatcher = dispatcher;
}

/** Relay an event through the WS server for cross-window broadcast. */
export function relayEvent(event: string, payload: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ relay: true, event, payload }));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket Connection Management
// ═══════════════════════════════════════════════════════════════════════════

function handleMessage(event: MessageEvent): void {
  let msg: { id?: number; result?: unknown; error?: string; event?: string; payload?: unknown };
  try {
    msg = JSON.parse(event.data as string);
  } catch {
    return;
  }

  // Request/response: has an id that matches a pending request
  if (msg.id !== undefined && pending.has(msg.id)) {
    const entry = pending.get(msg.id)!;
    pending.delete(msg.id);
    clearTimeout(entry.timer);

    if (msg.error) {
      entry.reject(new Error(msg.error));
    } else {
      entry.resolve(msg.result);
    }
    return;
  }

  // Server-push event: has an event field but no matching pending id
  if (msg.event && eventDispatcher) {
    eventDispatcher(msg.event, msg.payload);
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;

  const delay = Math.min(1000 * 2 ** reconnectAttempt, 10_000);
  reconnectAttempt++;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs().catch(() => {
      // connectWs already schedules another reconnect on failure
    });
  }, delay);
}

/**
 * Resolves the WebSocket URL — always queries Tauri IPC for the current port
 * and token. Never cached, because the sidecar may restart with a new token
 * and the Rust setup() may not have populated the state yet on first call.
 */
async function resolveWsUrl(): Promise<string> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    const port = await tauriInvoke<number>("get_ws_port");
    const token = await tauriInvoke<string>("get_ws_token");
    if (!token) {
      throw new Error("Sidecar token not yet available");
    }
    lastResolvedPort = port;
    resolvedToken = token;
    return `ws://localhost:${port}/ws?token=${token}`;
  }

  return `ws://localhost:${DEFAULT_WS_PORT}/ws`;
}

/**
 * Returns the actual WebSocket port the sidecar is on.
 * Call after connectWs() has resolved for a reliable value.
 */
export function getWsPort(): number {
  return lastResolvedPort;
}

/**
 * Returns the per-session auth token for the sidecar.
 * Call after connectWs() has resolved for a reliable value.
 */
export function getWsToken(): string | null {
  return resolvedToken;
}

/**
 * Returns the current WebSocket readyState, or CLOSED if no socket exists.
 */
export function getWsReadyState(): number {
  return ws?.readyState ?? WebSocket.CLOSED;
}

const WS_WAIT_TIMEOUT_MS = 15_000;

/**
 * Returns a promise that resolves once the WebSocket is open.
 * Waits through multiple reconnect cycles if needed (e.g. during startup
 * when the sidecar token isn't available yet).
 */
function waitForWs(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket connection"));
    }, WS_WAIT_TIMEOUT_MS);

    function check() {
      if (ws?.readyState === WebSocket.OPEN) {
        cleanup();
        resolve();
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      clearInterval(poll);
    }

    // Poll periodically — connectWs/scheduleReconnect drive the actual connection.
    const poll = setInterval(check, 100);
  });
}

/**
 * Establishes the WebSocket connection.
 * Call early in app init (main.tsx) but do NOT block rendering on it.
 */
export function connectWs(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    // Close any existing connection in non-OPEN state
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
      ws = null;
    }

    const url = await resolveWsUrl();

    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);

      socket.onopen = () => {
        ws = socket;
        reconnectAttempt = 0;
        console.info(`[WS] Connected to sidecar (port ${lastResolvedPort})`);
        resolve();
      };

      socket.onmessage = handleMessage;

      socket.onclose = () => {
        ws = null;
        scheduleReconnect();
      };

      socket.onerror = () => {
        ws = null;
        reject(new Error("WebSocket connection failed"));
        scheduleReconnect();
      };
    });
  })().finally(() => {
    connectingPromise = null;
  });

  return connectingPromise;
}

/** Closes the WebSocket and stops reconnection */
export function disconnectWs(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }
  // Reject all pending requests
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error("WebSocket disconnected"));
    pending.delete(id);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// invoke() — Main Export
// ═══════════════════════════════════════════════════════════════════════════

function wsInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const id = ++requestId;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`WebSocket request timed out: ${cmd} (id=${id})`));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    });

    ws!.send(JSON.stringify({ id, cmd, args }));
  });
}

/**
 * Drop-in replacement for `invoke()` from `@tauri-apps/api/core`.
 *
 * Routes:
 * - Native commands: Tauri IPC (or no-op defaults in browser)
 * - Data commands: WebSocket only (sidecar must be running)
 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  // Native commands: Tauri IPC or browser defaults
  if (NATIVE_COMMANDS.has(cmd)) {
    if (isTauri()) {
      const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
      return tauriInvoke<T>(cmd, args);
    }
    return (NATIVE_DEFAULTS[cmd] ?? undefined) as T;
  }

  // Data commands: WebSocket only (sidecar must be running)
  if (ws?.readyState === WebSocket.OPEN) {
    return wsInvoke<T>(cmd, args);
  }

  // Wait for WS to connect (may take multiple reconnect attempts during startup)
  await waitForWs();
  return wsInvoke<T>(cmd, args);
}
