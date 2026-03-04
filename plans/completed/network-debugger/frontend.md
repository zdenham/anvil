# Network Debugger — Frontend

Store, UI components, event bridge routing, and debug panel integration.

## Phases

- [x] Create store and types (`src/stores/network-debugger/`)
- [x] Wire event bridge routing
- [x] Add debug panel tab integration
- [x] Build network debugger container + request list
- [x] Build request detail pane with headers/body/timing tabs
- [x] Add copy-as-cURL utility

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Context

Read these files before starting — they are the template patterns to follow:

**Store pattern:**
- `src/stores/event-debugger-store.ts` — Zustand store with capture flag, 500-item cap, filters, selected item. Follow this exact pattern.

**UI pattern:**
- `src/components/debug-panel/event-debugger.tsx` — two-panel 60/40 container (25 lines)
- `src/components/debug-panel/event-list.tsx` — left pane with toolbar, filter bar, scrollable list (~220 lines)
- `src/components/debug-panel/event-detail.tsx` — right pane with collapsible JSON viewers (~210 lines)

**Integration points:**
- `src/stores/debug-panel/types.ts` — `DebugPanelTabSchema` enum, add `"network"`
- `src/components/debug-panel/debug-panel.tsx` — `TABS` array + conditional render
- `src/lib/event-bridge.ts` — route `network` type messages from hub to store

**Coding conventions** (from `docs/agents.md`):
- kebab-case files, <250 lines per file, <50 lines per function
- Use `logger` from `@/lib/logger-client`, never `console.log`
- Strong types, avoid `any`
- Prefer existing types over declaring new ones

## Shared type reference

The agent sub-plan creates `core/types/network-events.ts`. Here's the type for reference — you'll import it from `@core/types/network-events`:

```ts
export type NetworkEvent =
  | { type: "request-start"; requestId: string; url: string; method: string; headers: Record<string, string>; body: string | null; bodySize: number; timestamp: number }
  | { type: "response-headers"; requestId: string; status: number; statusText: string; headers: Record<string, string>; duration: number }
  | { type: "response-chunk"; requestId: string; content: string; chunkSize: number; totalSize: number }
  | { type: "response-end"; requestId: string; bodySize: number }
  | { type: "request-error"; requestId: string; error: string; duration: number };
```

The hub message arrives with `type: "network"` and `networkType` carrying the event discriminator (e.g. `"request-start"`). All other fields are spread at the top level.

---

## Phase 1: Store and types

### `src/stores/network-debugger/types.ts` (~40 lines)

```ts
export interface NetworkRequest {
  id: string;                              // requestId from agent
  threadId: string;                        // from hub message senderId context
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  bodySize: number;
  timestamp: number;
  // Filled as response arrives:
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody: string;                    // accumulated chunks
  duration?: number;
  responseSize?: number;
  error?: string;
  // Streaming state:
  chunks: number;
  streaming: boolean;
}

export interface NetworkDebuggerState {
  requests: Map<string, NetworkRequest>;
  selectedRequestId: string | null;
  isCapturing: boolean;
  filter: string;
}
```

### `src/stores/network-debugger/store.ts` (~80 lines)

Follow the `event-debugger-store.ts` pattern exactly:

```ts
import { create } from "zustand";
import { logger } from "@/lib/logger-client";
import type { NetworkRequest, NetworkDebuggerState } from "./types";

const MAX_REQUESTS = 500;

interface NetworkDebuggerActions {
  handleRequestStart: (msg: Record<string, unknown>) => void;
  handleResponseHeaders: (msg: Record<string, unknown>) => void;
  handleResponseChunk: (msg: Record<string, unknown>) => void;
  handleResponseEnd: (msg: Record<string, unknown>) => void;
  handleRequestError: (msg: Record<string, unknown>) => void;
  toggleCapture: () => void;
  clearRequests: () => void;
  setFilter: (filter: string) => void;
  selectRequest: (id: string | null) => void;
  filteredRequests: () => NetworkRequest[];
}
```

Key behaviors:
- **`handleRequestStart`** — create new `NetworkRequest` entry in map, evict oldest if > 500
- **`handleResponseHeaders`** — update existing request with status, headers, duration
- **`handleResponseChunk`** — append `content` to `responseBody`, increment `chunks`, update `responseSize`
- **`handleResponseEnd`** — set `streaming = false`, set final `responseSize`
- **`handleRequestError`** — set `error`, `streaming = false`
- **`toggleCapture`** — flip `isCapturing`, log state change
- **`clearRequests`** — reset map, clear selection
- **`filteredRequests`** — filter by URL substring match on `filter` string

Memory guard: when `requests.size > MAX_REQUESTS`, delete the oldest entry (first key in map iteration order).

### `src/stores/network-debugger/service.ts` (~60 lines)

Service layer that dispatches incoming hub messages to the correct store method. Single entry point:

```ts
export function handleNetworkMessage(msg: Record<string, unknown>): void {
  const store = useNetworkDebuggerStore.getState();
  const networkType = msg.networkType as string;

  switch (networkType) {
    case "request-start":
      store.handleRequestStart(msg);
      break;
    case "response-headers":
      store.handleResponseHeaders(msg);
      break;
    // ... etc
  }
}
```

### `src/stores/network-debugger/index.ts` (~5 lines)

Barrel export for `useNetworkDebuggerStore`, `handleNetworkMessage`, and types.

---

## Phase 2: Event bridge routing

### `src/lib/event-bridge.ts`

Find where `agent:message` Tauri events are processed (look for where the event debugger's `captureEvent` is called). Add a handler for `type === "network"`:

```ts
// In the agent message handler:
if (msg.type === "network") {
  handleNetworkMessage(msg);
  return; // don't pass to event debugger
}
```

Import `handleNetworkMessage` from `@/stores/network-debugger`.

Note: The exact insertion point depends on the current event-bridge structure. Look for where `useEventDebuggerStore.getState().captureEvent(msg)` is called and add the network handler before it (since network messages shouldn't also appear in the event debugger).

---

## Phase 3: Debug panel tab integration

### `src/stores/debug-panel/types.ts`

Change the tab enum:
```ts
// Before:
export const DebugPanelTabSchema = z.enum(["logs", "diagnostics", "events"]);
// After:
export const DebugPanelTabSchema = z.enum(["logs", "diagnostics", "events", "network"]);
```

### `src/components/debug-panel/debug-panel.tsx`

1. Add import: `import { NetworkDebugger } from "@/components/debug-panel/network-debugger";`
2. Add to `TABS` array: `{ id: "network", label: "Network", icon: Wifi }` (import `Wifi` from lucide-react)
3. Add render case: `{activeTab === "network" && <NetworkDebugger />}`

---

## Phase 4: Network debugger container + request list

### `src/components/debug-panel/network-debugger.tsx` (~50 lines)

Two-panel layout matching `event-debugger.tsx` exactly:

```tsx
import { NetworkRequestList } from "./network-request-list";
import { NetworkRequestDetail } from "./network-request-detail";

export function NetworkDebugger() {
  return (
    <div className="flex h-full min-h-0">
      <div className="w-[60%] h-full border-r border-surface-700 min-h-0">
        <NetworkRequestList />
      </div>
      <div className="w-[40%] h-full min-h-0">
        <NetworkRequestDetail />
      </div>
    </div>
  );
}
```

### `src/components/debug-panel/network-request-list.tsx` (~100 lines)

Follow `event-list.tsx` pattern. Structure:

**Toolbar** — capture toggle + clear button + request count (identical pattern to event-list toolbar)

**Filter bar** — text input filtering on URL (simpler than event-list since no type badges needed)

**Request rows** — each row shows:
- Status badge: color-coded (`green-500` for 2xx, `yellow-500` for 3xx, `red-500` for 4xx/5xx, `surface-500` for pending/streaming)
- Streaming indicator: animated dot for `streaming === true`
- Method (POST, GET, etc.)
- URL (path only, truncated — use `new URL(url).pathname`)
- Duration (formatted as `1.2s` or `450ms`)
- Response size (formatted as `1.2 KB`)

**Auto-scroll** — same pattern as event-list: `shouldAutoScroll` ref, scroll to bottom on new entries, disable when user scrolls up.

Click row → `selectRequest(id)`.

### Helper functions (inline or shared)

```ts
function formatDuration(ms?: number): string {
  if (ms == null) return "...";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function formatSize(bytes?: number): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function statusColor(status?: number): string {
  if (!status) return "text-surface-500";
  if (status < 300) return "text-green-400";
  if (status < 400) return "text-yellow-400";
  return "text-red-400";
}
```

---

## Phase 5: Request detail pane

### `src/components/debug-panel/network-request-detail.tsx` (~140 lines)

Right pane with tabs: **Headers** | **Body** | **Timing**

Use local state for active tab: `const [tab, setTab] = useState<"headers" | "body" | "timing">("headers")`

**Empty state** — when no request selected: centered "Select a request" text (same as event-detail empty state).

**Tab bar** — three small tab buttons at top of detail pane.

**Headers tab:**
- Two sections: "Request Headers" and "Response Headers"
- Each is a simple key-value table (2-column, monospace)
- Redacted values shown in `text-surface-500` italic
- Use `CollapsibleJson` from `event-detail.tsx` if it's exported, otherwise inline a simple table

**Body tab:**
- Two sections: "Request Body" and "Response Body"
- Pretty-print JSON with `JSON.stringify(JSON.parse(body), null, 2)` in a `<pre>` block
- If body is streaming (`streaming === true`), show accumulated body with a pulsing indicator and byte count
- Auto-scroll to bottom in streaming mode (same `shouldAutoScroll` pattern)
- For SSE responses (content-type `text/event-stream`), keep raw text display — don't try to parse SSE format

**Timing tab:**
- Simple display: request start timestamp, duration, chunks count, response size
- No waterfall visualization needed for v1 — just key metrics in a vertical list

**Copy as cURL button** — in the tab bar area (top-right). Calls `buildCurlCommand()` and copies to clipboard.

---

## Phase 6: Copy as cURL utility

### `src/lib/build-curl-command.ts` (~30 lines)

Pure function:

```ts
import type { NetworkRequest } from "@/stores/network-debugger/types";

export function buildCurlCommand(request: NetworkRequest): string {
  const parts: string[] = ["curl"];

  if (request.method !== "GET") {
    parts.push(`-X ${request.method}`);
  }

  parts.push(`'${request.url}'`);

  for (const [key, value] of Object.entries(request.requestHeaders)) {
    parts.push(`-H '${key}: ${value}'`);
  }

  if (request.requestBody) {
    // Escape single quotes in body
    const escaped = request.requestBody.replace(/'/g, "'\\''");
    parts.push(`-d '${escaped}'`);
  }

  return parts.join(" \\\n  ");
}
```

The clipboard copy + "Copied!" feedback is handled in the detail component using `navigator.clipboard.writeText()` and a brief state toggle.

---

## Files summary

### New files
| File | ~Lines |
|------|--------|
| `src/stores/network-debugger/types.ts` | ~40 |
| `src/stores/network-debugger/store.ts` | ~80 |
| `src/stores/network-debugger/service.ts` | ~60 |
| `src/stores/network-debugger/index.ts` | ~5 |
| `src/components/debug-panel/network-debugger.tsx` | ~50 |
| `src/components/debug-panel/network-request-list.tsx` | ~100 |
| `src/components/debug-panel/network-request-detail.tsx` | ~140 |
| `src/lib/build-curl-command.ts` | ~30 |

### Modified files
| File | Change |
|------|--------|
| `src/lib/event-bridge.ts` | Route `network` messages to store (~5 lines) |
| `src/stores/debug-panel/types.ts` | Add `"network"` to tab enum (~1 line) |
| `src/components/debug-panel/debug-panel.tsx` | Add tab + render case (~5 lines) |

### Verification

- Build passes: `pnpm build` from root
- Tab appears in debug panel and is selectable
- Store handles all 5 message types correctly (unit test the store actions)
- Request list renders with correct status colors and formatting
- Detail pane shows headers, body, timing for selected request
- Copy as cURL produces valid curl command (unit test `buildCurlCommand`)
