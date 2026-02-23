# C: Pure TypeScript SSE Client

Parent: [readme.md](./readme.md) | Design: [../buffered-event-gateway.md](../buffered-event-gateway.md) (Phase 4)

**Depends on:** Nothing — SSE wire format is defined in the parent plan. Can start immediately.

Implements a platform-agnostic, fetch-based SSE client that works in both browser and Node.js. Lives in `core/gateway/`.

## Phases

- [x] Add GatewayEvent and Channel Zod schemas to `core/types/`
- [x] Implement SSE frame parser
- [x] Implement GatewayClient with connect/disconnect/reconnect
- [x] Export from `core/` public API

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Shared Type Schemas in `core/types/`

**`core/types/gateway-events.ts`**:

```typescript
import { z } from "zod";

export const GatewayEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  channelId: z.string(),
  payload: z.record(z.unknown()),
  receivedAt: z.number(),
});

export type GatewayEvent = z.infer<typeof GatewayEventSchema>;

export const ChannelSchema = z.object({
  channelId: z.string().uuid(),
  deviceId: z.string().uuid(),
  type: z.literal("github"),
  label: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type Channel = z.infer<typeof ChannelSchema>;
```

Export from `core/types/index.ts`. These schemas are shared between server (workstream B) and client (this workstream). The server's `server/src/gateway/types/` files can re-export or duplicate — keeping `core/types/` as the canonical source.

---

## Phase 2: SSE Frame Parser

**`core/gateway/sse-parser.ts`**

A stateless, incremental SSE frame parser. Takes a text buffer, extracts complete frames, returns parsed fields + remaining buffer.

```typescript
export interface SSEFrame {
  id?: string;
  event?: string;
  data?: string;
}

export function parseSSEFrames(buffer: string): { frames: SSEFrame[]; remainder: string } {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop()!; // incomplete frame stays in buffer
  const frames: SSEFrame[] = [];

  for (const part of parts) {
    if (part.startsWith(":")) continue; // heartbeat / comment
    const frame: SSEFrame = {};
    for (const line of part.split("\n")) {
      const colonIdx = line.indexOf(": ");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 2);
      if (key === "id") frame.id = value;
      else if (key === "event") frame.event = value;
      else if (key === "data") frame.data = frame.data ? frame.data + "\n" + value : value;
    }
    if (frame.data) frames.push(frame);
  }

  return { frames, remainder };
}
```

Key details:
- Multi-line `data:` fields are concatenated with `\n` (per SSE spec)
- Heartbeat lines (`:heartbeat`) are silently skipped
- Returns remainder so the caller can prepend it to the next chunk

---

## Phase 3: GatewayClient

**`core/gateway/client.ts`**

The main client class. Uses constructor-injected callbacks for persistence and event dispatch — no platform-specific imports.

```typescript
export interface GatewayClientOptions {
  baseUrl: string;
  deviceId: string;
  loadLastEventId: () => Promise<string | null>;
  saveLastEventId: (id: string) => Promise<void>;
  onEvent: (event: GatewayEvent) => void;
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void;
}
```

### Connect flow

1. Load `lastEventId` via callback
2. `fetch(url, { headers: { Accept: "text/event-stream", "Last-Event-ID": lastEventId }, signal })`
3. Read `response.body` as `ReadableStream` via `getReader()`
4. Feed chunks through `parseSSEFrames()` incrementally
5. For each complete frame: parse `data` as JSON → `GatewayEvent`, call `onEvent`, persist stream ID via `saveLastEventId(frame.id)`

### Reconnect with backoff

On disconnect (stream ends, fetch error, abort):
- Wait: 1s → 2s → 4s → 8s → 16s → 30s (capped)
- Call `connect()` again (re-loads `lastEventId` fresh)
- Reset backoff on successful connection (first event received)

### Disconnect

- `AbortController.abort()` to cancel the fetch
- Clear any pending reconnect timeout
- Call `onStatus?.("disconnected")`

### No platform-specific code

The client never touches `localStorage`, `fs`, `process`, or `window`. All I/O is injected via `GatewayClientOptions`. Platform adapters (browser `localStorage`, Node `fs`) are consumer-side code documented in the parent plan.

---

## Phase 4: Export from `core/`

Add exports to `core/index.ts` (or the appropriate barrel file):

```typescript
export { GatewayClient } from "./gateway/client.js";
export type { GatewayClientOptions } from "./gateway/client.js";
export { parseSSEFrames } from "./gateway/sse-parser.js";
export type { SSEFrame } from "./gateway/sse-parser.js";
export { GatewayEventSchema, ChannelSchema } from "./types/gateway-events.js";
export type { GatewayEvent, Channel } from "./types/gateway-events.js";
```

---

## Completion Criteria

- `core/types/gateway-events.ts` defines `GatewayEvent` and `Channel` Zod schemas
- `core/gateway/sse-parser.ts` parses SSE frames incrementally, handles heartbeats and multi-line data
- `core/gateway/client.ts` exports `GatewayClient` with `connect()` / `disconnect()`
- Client uses `fetch` + `ReadableStream` — no `EventSource` dependency
- No platform-specific imports (`fs`, `localStorage`, `window`) in any `core/gateway/` file
- Reconnect with capped exponential backoff
- All types exported from `core/` barrel
