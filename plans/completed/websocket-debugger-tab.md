# WebSocket Debugger Tab

## Goal

Add a new **"WebSocket"** tab to the debug panel that shows the sidecar WebSocket server's port, connection status, auth info, and lets developers hit the health endpoint (and future test endpoints) — giving instant visibility into whether the sidecar process is alive without leaving the app.

## Phases

- [x] Add tab definition and routing

- [x] Create WebSocket status store

- [x] Build the WebSocket debugger UI

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1 — Add tab definition and routing

**Files to modify:**

- `src/stores/debug-panel/types.ts` — Add `"websocket"` to `DebugPanelTabSchema`
- `src/components/debug-panel/debug-panel.tsx` — Add the new tab entry to `TABS` array (use `Cable` or `Plug` icon from lucide-react), add conditional render for the new page component

This is the minimal wiring to make the tab appear (rendering a placeholder until Phase 3).

## Phase 2 — Create WebSocket status store

**New file:** `src/stores/websocket-debugger/store.ts`**New file:** `src/stores/websocket-debugger/types.ts`**New file:** `src/stores/websocket-debugger/index.ts`

The store tracks:

```typescript
interface WebSocketDebuggerState {
  // Connection info (populated on hydrate / poll)
  port: number | null;
  appSuffix: string | null;
  authToken: string | null; // masked for display, full value available on click
  connectionStatus: "connected" | "disconnected" | "connecting" | "error";

  // Health check result from GET /health
  lastHealthCheck: { status: string; port: number; appSuffix: string } | null;
  lastHealthCheckAt: number | null;

  // Endpoint test results (extensible for future test endpoints)
  endpointResults: Record<string, { response: unknown; status: number; at: number }>;
}
```

**Data sources:**

1. **Port & token** — call existing Tauri IPC commands `get_ws_port()` and `get_ws_token()` (already exposed in `src/lib/invoke.ts`)
2. **Health check** — fetch `http://localhost:{port}/health` (no auth required per sidecar code)
3. **Connection status** — read from the existing WS singleton in `src/lib/invoke.ts` (expose a `getReadyState()` accessor or subscribe to state changes)

**Key design decisions:**

- Health check is manual (button press), not automatic, to avoid noise
- `endpointResults` map is extensible — future test endpoints can be added without changing the store shape
- Expose `getWsReadyState()` from `src/lib/invoke.ts` so the store can derive `connectionStatus` without duplicating connection logic

## Phase 3 — Build the WebSocket debugger UI

**New file:** `src/components/debug-panel/websocket-page.tsx`

Layout (top to bottom):

### Status Bar (always visible)

| Element | Source |
| --- | --- |
| Connection dot (green/yellow/red) | `connectionStatus` |
| `ws://localhost:{port}/ws` | `port` from store |
| App suffix badge `dev` | `appSuffix` |
| Auth token (masked `a1b2••••`) with copy button | `authToken` |

### Endpoint Actions

- **"Check Health" button** — hits `/health`, displays result below
- Designed to accommodate future test endpoint buttons in the same row

### Endpoint Results (shown after a check)

Pretty-printed JSON of the endpoint response with status code and timestamp. Each endpoint result is collapsible and stacks vertically.

**Styling:** Follow existing debug panel conventions — `surface-950` background, `surface-700` borders, `text-surface-100` for primary text, `text-surface-400` for secondary.

## Non-goals

- No live message inspection or capture (may revisit later)
- No modifications to the sidecar server itself (all data is already available)
- No new Tauri IPC commands (port and token are already exposed)
- No WebSocket reconnect controls (that's the connection manager's job)