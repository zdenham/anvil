# Fix: No transport available for command: get_paths_info

## Problem

`invoke()` throws `No transport available for command: get_paths_info` when neither WebSocket nor Tauri IPC is available at call time.

**Error path** (`src/lib/invoke.ts:264-274`):
1. Command is NOT in `NATIVE_COMMANDS` → treated as data command
2. WebSocket is not connected (`ws` is null or not OPEN)
3. `isTauri()` returns false (no `__TAURI_INTERNALS__` on window)
4. Throws immediately with no retry

**When it happens**:
- **Main window** (`main.tsx`): `connectWs()` is fire-and-forget (line 27), then `invoke("get_paths_info")` runs at line 81 before WS is ready. In browser dev mode, `isTauri()` is false, so both transports fail.
- **Secondary windows** (`control-panel-main.tsx`, `spotlight-main.tsx`): They never call `connectWs()` at all. Each Tauri window has its own JS context — the main window's WS connection doesn't help them. They rely entirely on `isTauri()` being true.

## Phases

- [x] Make `invoke()` wait for WS connection before throwing
- [x] Add `connectWs()` to secondary window entry points

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Make `invoke()` wait for WS connection before throwing

**File**: `src/lib/invoke.ts`

Instead of throwing immediately when neither transport is available, `invoke()` should await the in-progress WS connection attempt before giving up. The connection promise from `connectWs()` already exists — we just need to expose it.

```typescript
// Track the in-flight connection promise
let connectingPromise: Promise<void> | null = null;

export function connectWs(): Promise<void> {
  // If already connected, resolve immediately
  if (ws?.readyState === WebSocket.OPEN) return Promise.resolve();
  // If already connecting, return the existing promise
  if (connectingPromise) return connectingPromise;

  connectingPromise = new Promise<void>((resolve, reject) => {
    // ... existing connection logic ...
  }).finally(() => {
    connectingPromise = null;
  });

  return connectingPromise;
}
```

Then in `invoke()`, after the WS and Tauri checks both fail:

```typescript
// Neither transport ready — wait for WS connection if one is in progress
if (connectingPromise) {
  await connectingPromise;
  if (ws?.readyState === WebSocket.OPEN) {
    return wsInvoke<T>(cmd, args);
  }
}

throw new Error(`No transport available for command: ${cmd}`);
```

This way, if `connectWs()` was already called and is connecting, `invoke()` will wait for it rather than throwing immediately.

## Phase 2: Add `connectWs()` to secondary windows

**Files**: `src/control-panel-main.tsx`, `src/spotlight-main.tsx`

Add `connectWs()` calls early in each entry point, mirroring `main.tsx`:

```typescript
import { invoke, connectWs } from "@/lib/invoke";

// Connect WebSocket transport early (non-blocking)
connectWs().catch(() => {
  // WS connection failure is non-fatal — Tauri IPC is the fallback
});
```

This ensures all windows have WS transport available as a primary channel, with Tauri IPC as fallback. Without this, secondary windows in browser/dev mode have no transport at all.
