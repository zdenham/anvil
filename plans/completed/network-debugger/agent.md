# Network Debugger — Agent Side

Interceptor, hub transport types, runner initialization, and env var wiring.

## Phases

- [x] Create shared types (`core/types/network-events.ts`)
- [x] Create network interceptor (`agents/src/lib/network-interceptor.ts`)
- [x] Add hub transport type and runner initialization
- [x] Wire env var in agent-service

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Context

Read these files before starting:
- `agents/src/lib/hub/types.ts` — existing hub message types (add `NetworkMessage`)
- `agents/src/lib/hub/client.ts` — `send()` accepts any `SocketMessage`, no changes needed
- `agents/src/runner.ts` — add interceptor init near line ~365, before `runAgentLoop()`
- `src/lib/agent-service.ts` — env var pattern at lines ~772-783
- `docs/agents.md` — coding conventions (kebab-case files, <250 lines, <50 line functions, use `logger` not `console.log`)

## Phase 1: Shared types

**New file: `core/types/network-events.ts`** (~40 lines)

Define the `NetworkEvent` discriminated union. This is consumed by both the agent interceptor and the frontend store.

```ts
export type NetworkEvent =
  | {
      type: "request-start";
      requestId: string;
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string | null;
      bodySize: number;
      timestamp: number;
    }
  | {
      type: "response-headers";
      requestId: string;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      duration: number;
    }
  | {
      type: "response-chunk";
      requestId: string;
      content: string;
      chunkSize: number;
      totalSize: number;
    }
  | {
      type: "response-end";
      requestId: string;
      bodySize: number;
    }
  | {
      type: "request-error";
      requestId: string;
      error: string;
      duration: number;
    };
```

No Zod schema needed — these events flow through the hub socket which is trusted internal IPC.

## Phase 2: Network interceptor

**New file: `agents/src/lib/network-interceptor.ts`** (~150 lines)

A class that wraps `globalThis.fetch` to capture all HTTP traffic. The Claude Agent SDK uses native `fetch()` backed by undici, so this captures all SDK traffic.

### Class structure

```ts
import type { NetworkEvent } from "@core/types/network-events.js";

export class NetworkInterceptor {
  private originalFetch: typeof globalThis.fetch;
  private emitFn: (event: NetworkEvent) => void;
  private enabled = false;
  private requestCounter = 0;

  constructor(emitFn: (event: NetworkEvent) => void) { ... }
  enable(): void { ... }
  disable(): void { ... }
  private async interceptedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> { ... }
  private wrapReadableStream(stream: ReadableStream<Uint8Array>, requestId: string): ReadableStream<Uint8Array> { ... }
}
```

### Key behaviors

1. **`enable()`** — replaces `globalThis.fetch` with `interceptedFetch`. Idempotent.
2. **`disable()`** — restores original fetch. Idempotent.
3. **`interceptedFetch()`** — wraps each call:
   - Emit `request-start` with URL, method, sanitized headers, captured body (truncated at 200KB)
   - Call original fetch
   - Emit `response-headers` with status, headers, duration
   - If response has body, wrap the `ReadableStream` to emit `response-chunk` events
   - If no body, emit `response-end` immediately
   - On error, emit `request-error` and re-throw
4. **`wrapReadableStream()`** — creates a new `ReadableStream` that reads from the original, emits `response-chunk` for each chunk (with `TextDecoder`), and emits `response-end` when done

### Helper functions (module-level, not exported)

**`sanitizeHeaders(headers?: HeadersInit): Record<string, string>`**
- Convert `HeadersInit` (Headers object, array of tuples, or record) to a plain record
- Redact values for keys in `Set(["authorization", "x-api-key", "cookie"])` → `"[REDACTED]"`

**`captureRequestBody(body?: BodyInit | null): string | null`**
- If string, return directly (truncated at 200KB)
- If JSON-stringifiable, stringify (truncated at 200KB)
- Otherwise return `null`
- Append `" [TRUNCATED]"` marker if truncated

**`estimateBodySize(body?: BodyInit | null): number`**
- Return byte length estimate: string length, ArrayBuffer byteLength, or 0

## Phase 3: Hub transport + runner init

### `agents/src/lib/hub/types.ts` — Add NetworkMessage

Add after the existing `HeartbeatMessage`:

```ts
export interface NetworkMessage extends SocketMessage {
  type: "network";
  networkType: string; // "request-start" | "response-headers" | etc.
  requestId: string;
  [key: string]: unknown;
}
```

Note: We spread the `NetworkEvent` fields into the socket message rather than nesting, so the frontend can access fields directly. The `type` field is `"network"` (the hub message type), and `networkType` carries the `NetworkEvent.type` discriminator.

### `agents/src/runner.ts` — Initialize interceptor

Add near the existing diagnostic config initialization (around line ~237-244 pattern), before `runAgentLoop()`:

```ts
if (process.env.MORT_NETWORK_DEBUG === "1") {
  const { NetworkInterceptor } = await import("@/lib/network-interceptor.js");
  const interceptor = new NetworkInterceptor((event) => {
    hub?.send({
      type: "network",
      networkType: event.type,
      ...event,
    });
  });
  interceptor.enable();
}
```

Use dynamic `import()` so the module is only loaded when the flag is set.

## Phase 4: Env var wiring

### `src/lib/agent-service.ts` — Pass env var

Follow the existing `MORT_DIAGNOSTIC_LOGGING` pattern (lines ~772-783). Add `MORT_NETWORK_DEBUG` to the env vars block:

```ts
// After the existing diagnosticEnv block:
const networkDebug = useSettingsStore.getState().workspace.networkDebugger;
if (networkDebug) {
  envVars.MORT_NETWORK_DEBUG = "1";
}
```

If there's no `networkDebugger` setting in the workspace settings yet, use a simpler approach — check if the debug panel's network tab has ever been activated, or just hardcode it as enabled when the debug panel is open. The simplest approach: always set `MORT_NETWORK_DEBUG=1` when `diagnosticLogging` is enabled, since network debugging is a diagnostic feature.

**Fallback if no settings field exists:** Just set it unconditionally for now. The interceptor has near-zero overhead and the hub socket handles the volume fine. A settings toggle can be added later.

---

## Files summary

### New files
| File | ~Lines |
|------|--------|
| `core/types/network-events.ts` | ~40 |
| `agents/src/lib/network-interceptor.ts` | ~150 |

### Modified files
| File | Change |
|------|--------|
| `agents/src/lib/hub/types.ts` | Add `NetworkMessage` interface |
| `agents/src/runner.ts` | Add interceptor init block (~8 lines) |
| `src/lib/agent-service.ts` | Add `MORT_NETWORK_DEBUG` env var (~3 lines) |

### Verification

- Unit test the `NetworkInterceptor` class: mock `globalThis.fetch`, enable interceptor, make a fetch call, verify events emitted in correct order
- Unit test `sanitizeHeaders`: verify `authorization`, `x-api-key`, `cookie` are redacted
- Unit test `captureRequestBody`: verify string passthrough, JSON stringify, 200KB truncation
- Test file: `agents/src/lib/__tests__/network-interceptor.test.ts`
