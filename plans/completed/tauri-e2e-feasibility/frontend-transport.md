# Sub-Plan 2: Frontend Transport Wrappers + Import Migration

**Prerequisite:** [ws-server.md](./ws-server.md) — WS server running on `:9600` with proof-of-concept commands
**Delivers:** `invoke.ts` + `events.ts` wrappers, all frontend files migrated off direct Tauri imports

## Context

The frontend currently imports `invoke` from `@tauri-apps/api/core` in ~25 files and event APIs in ~7 files. A centralized `tauri-commands.ts` already wraps most invoke calls with Zod validation. The migration is to insert a transport abstraction below `tauri-commands.ts` that routes to either WS or Tauri IPC.

### Key discovery from audit

`src/lib/tauri-commands.ts` already acts as a command hub — most files call its typed wrappers rather than raw `invoke()`. This means:
- The **primary migration target is `tauri-commands.ts` itself** — change its invoke import
- Files that import `invoke` directly (outside tauri-commands) are the secondary migration (~15 files)
- The event system is centralized in `event-bridge.ts` — single file to wrap

## Phases

- [x] Create `src/lib/runtime.ts` with `isTauri()` detection
- [x] Create `src/lib/invoke.ts` transport wrapper (WS + Tauri fallback)
- [x] Create `src/lib/events.ts` event wrapper (WS push + Tauri events)
- [x] Migrate `tauri-commands.ts` and remaining direct invoke imports (~25 files)
- [x] Create browser stubs for window APIs (`getCurrentWindow`, `LogicalSize`, etc.)
- [x] Verify: app works unchanged in Tauri WebView, and `http://localhost:1420` loads in Chrome with WS transport

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Runtime Detection

Create `src/lib/runtime.ts`:

```typescript
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
```

Small module, no dependencies. Referenced by invoke.ts, events.ts, and browser stubs.

## Phase 2: Transport Wrapper (`invoke.ts`)

Create `src/lib/invoke.ts` with the dual-transport pattern from the parent plan.

### Design

```typescript
// src/lib/invoke.ts
import { isTauri } from './runtime';

const WS_URL = 'ws://127.0.0.1:9600';
const NATIVE_COMMANDS = new Set([/* ~26 commands from parent plan */]);
const NATIVE_DEFAULTS: Record<string, unknown> = {/* sensible returns for browser */};

let ws: WebSocket | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: Function; reject: Function }>();

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (NATIVE_COMMANDS.has(cmd)) {
    if (isTauri()) {
      const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
      return tauriInvoke<T>(cmd, args);
    }
    return (NATIVE_DEFAULTS[cmd] ?? undefined) as T;
  }

  // Data command → prefer WS, fall back to Tauri IPC
  if (ws?.readyState === WebSocket.OPEN) {
    return wsInvoke<T>(cmd, args);
  }
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke<T>(cmd, args);
  }
  throw new Error(`No transport available for command: ${cmd}`);
}
```

### Key decisions

- **Dynamic import** for `@tauri-apps/api/core` — avoids import errors in browser context where Tauri globals don't exist
- **WS connection management** — lazy connect on first data command, auto-reconnect with backoff
- **Request/response matching** — `id` field on every WS message, pending promise map
- **Timeout** — reject pending promises after 30s (configurable)
- **Type signature matches Tauri's `invoke<T>`** — drop-in replacement

### Connection lifecycle

```typescript
export function connectWs(): Promise<void> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => resolve();
    ws.onmessage = handleMessage;
    ws.onclose = () => { ws = null; scheduleReconnect(); };
    ws.onerror = (e) => reject(e);
  });
}
```

Call `connectWs()` early in app initialization (main.tsx), but don't block rendering on it.

## Phase 3: Event Wrapper (`events.ts`)

Create `src/lib/events.ts` wrapping `listen()` and `emit()`:

```typescript
// src/lib/events.ts
import { isTauri } from './runtime';

type EventHandler<T> = (event: { payload: T }) => void;
type UnlistenFn = () => void;

const wsListeners = new Map<string, Set<EventHandler<unknown>>>();

export async function listen<T>(event: string, handler: EventHandler<T>): Promise<UnlistenFn> {
  if (isTauri()) {
    const { listen: tauriListen } = await import('@tauri-apps/api/event');
    return tauriListen<T>(event, handler);
  }
  // Browser: register for WS push events
  if (!wsListeners.has(event)) wsListeners.set(event, new Set());
  wsListeners.get(event)!.add(handler as EventHandler<unknown>);
  return () => { wsListeners.get(event)?.delete(handler as EventHandler<unknown>); };
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  if (isTauri()) {
    const { emit: tauriEmit } = await import('@tauri-apps/api/event');
    return tauriEmit(event, payload);
  }
  // Browser: send as WS message (server can relay to other listeners)
  // For now, most emit() calls are panel/window coordination — no-op in browser
}
```

### WS push event routing

The WS server sends push messages for events (agent:message, terminal:output, file-watcher:changed). These arrive on the same WebSocket connection and are dispatched to registered listeners:

```typescript
// Called from invoke.ts handleMessage when msg has no id (server push)
export function dispatchWsEvent(event: string, payload: unknown) {
  const handlers = wsListeners.get(event);
  if (handlers) {
    for (const handler of handlers) {
      handler({ payload });
    }
  }
}
```

### Integration with event-bridge.ts

`event-bridge.ts` is the app's event hub. It currently imports from `@tauri-apps/api/event`. Update it to import from `@/lib/events` instead. The bridge's existing mitt-based local event bus continues to work — only the Tauri subscription layer changes.

## Phase 4: Import Migration

### Strategy

Two categories of migration:

**Category A: `tauri-commands.ts` (single file, highest impact)**
- Currently imports `invoke` from `@tauri-apps/api/core`
- Change to `import { invoke } from '@/lib/invoke'`
- This automatically routes all typed command calls through the transport layer
- **~70% of the migration surface is handled by this one change**

**Category B: Direct invoke callers (~15 files)**

Files that call `invoke()` directly (not through tauri-commands.ts):

| File | Commands used | Notes |
|------|--------------|-------|
| `src/main.tsx` | Initialization calls | May also need event migration |
| `src/App.tsx` | Window setup | Also uses getCurrentWindow, LogicalSize |
| `src/lib/agent-service.ts` | Agent spawn, path resolution | Also uses shell plugin, events |
| `src/lib/hotkey-service.ts` | Hotkey registration | Native commands — mock in browser |
| `src/lib/panel-navigation.ts` | Panel commands | Native — mock in browser |
| `src/lib/logger-client.ts` | web_log, web_log_batch | Data commands |
| `src/lib/filesystem-client.ts` | File operations | Data commands |
| `src/lib/quick-action-executor.ts` | Mixed | Needs case-by-case review |
| `src/components/spotlight/spotlight.tsx` | Spotlight commands | Native — mock |
| `src/components/clipboard/clipboard-manager.tsx` | Clipboard commands | Native — mock |
| `src/components/error-panel.tsx` | Error panel commands | Native — mock |
| `src/components/content-pane/file-content.tsx` | File viewing | Data commands |
| `src/components/content-pane/terminal-content.tsx` | Terminal commands | Data commands |
| `src/entities/terminal-sessions/service.ts` | Terminal spawn/write | Data commands |
| `src/entities/repositories/service.ts` | Repo operations | Data commands |

**Category C: Event imports (~7 files)**

| File | Current import | Action |
|------|---------------|--------|
| `src/lib/event-bridge.ts` | `listen`, `emit`, `UnlistenFn` from `@tauri-apps/api/event` | Change to `@/lib/events` |
| `src/lib/agent-service.ts` | `listen` | Change to `@/lib/events` |
| `src/main.tsx` | Event setup | Change to `@/lib/events` |
| `src/components/main-window/main-window-layout.tsx` | `listen` | Change to `@/lib/events` |
| `src/entities/threads/listeners.ts` | `listen` | Change to `@/lib/events` |
| `src/entities/terminal-sessions/listeners.ts` | `listen` | Change to `@/lib/events` |
| `src/lib/thread-creation-service.ts` | `emit` | Change to `@/lib/events` |

### Execution

Mechanical find-and-replace for import paths. Each file:
1. Change `import { invoke } from '@tauri-apps/api/core'` → `import { invoke } from '@/lib/invoke'`
2. Change `import { listen, emit } from '@tauri-apps/api/event'` → `import { listen, emit } from '@/lib/events'`
3. Remove any now-unused `@tauri-apps/api/*` imports
4. Verify TypeScript compiles (`pnpm tsc --noEmit`)

## Phase 5: Browser Window Stubs

Create `src/lib/browser-stubs.ts` for Tauri-specific APIs used outside of invoke:

```typescript
// src/lib/browser-stubs.ts
export class LogicalSize {
  constructor(public width: number, public height: number) {}
}

export function getCurrentWindow() {
  return {
    label: 'browser',
    setSize: async () => {},
    startDragging: async () => {},
    isFullscreen: async () => false,
    onResized: async () => () => {},
    show: async () => {},
    hide: async () => {},
  };
}

export function convertFileSrc(path: string): string {
  return `http://127.0.0.1:9600/files?path=${encodeURIComponent(path)}`;
}

export async function getVersion(): Promise<string> {
  return 'dev';
}
```

Files that use these APIs (6 files from audit) get a conditional import:

```typescript
const { getCurrentWindow } = isTauri()
  ? await import('@tauri-apps/api/window')
  : await import('@/lib/browser-stubs');
```

Or consolidate into a `src/lib/window.ts` that exports the right thing based on runtime.

## Phase 6: Verification

### In Tauri WebView (no regression)
- [ ] App starts normally via `pnpm dev`
- [ ] Thread list loads, content pane renders
- [ ] Agent messages arrive in real-time
- [ ] Terminal works (spawn, input, output)
- [ ] All existing functionality unchanged

### In Chrome (new capability)
- [ ] Navigate to `http://localhost:1420` in Chrome
- [ ] App renders (React loads, layout appears)
- [ ] Data commands work via WS (thread list loads, files render)
- [ ] Native commands gracefully no-op (no errors in console)
- [ ] File previews load via HTTP file server
- [ ] Chrome DevTools work (React profiler, network tab, etc.)

## Risks

| Risk | Mitigation |
|------|-----------|
| Dynamic imports add async where there was sync | Most call sites already use `await invoke()`. The import itself is cached after first load. |
| Tauri tree-shaking breaks | Keep `@tauri-apps/api` as a dependency — it's still used in Tauri context. Vite will tree-shake it in browser builds if needed. |
| Event ordering changes between WS push and Tauri events | Both are async. If ordering matters, add sequence numbers to WS events (same pattern as AgentHub). |
| Shell plugin has no WS equivalent | Shell commands (`Command.create()`) remain Tauri-only. In browser context, terminal commands go through WS. Direct shell execution is not needed in browser E2E tests. |

## Output

After this plan completes:
- **All frontend invoke/event calls** go through `@/lib/invoke` and `@/lib/events`
- **No direct `@tauri-apps/api/core` or `@tauri-apps/api/event` imports** remain in components/services
- **The app works in both Tauri WebView and Chrome** (with WS server from sub-plan 1 running)
- The foundation is set for full-coverage-e2e.md to route all remaining commands
