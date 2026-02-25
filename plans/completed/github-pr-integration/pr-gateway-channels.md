# D1: Gateway Channels Entity & Webhook Lifecycle

Implements the gateway-channels entity following the standard entity pattern (types, store, service, listeners). This entity owns the `GatewayClient` lifecycle and manages per-repo GitHub webhooks via the `gh` CLI. Channels are created for all repos by default during hydration -- the auto-address toggle (implemented in D2) only controls whether agents are spawned, not whether events are received.

**Parent plan:** [pr-auto-address.md](./pr-auto-address.md) (Phases 1-2)
**Depends on:** A (PR entity & GhCli), existing gateway client (`core/gateway/client.ts`)
**Depended on by:** [pr-event-handling.md](./pr-event-handling.md) (D2)

## File Summary

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `core/types/gateway-channel.ts` | CREATE | Zod schema + type for `GatewayChannelMetadata` |
| 2 | `core/types/events.ts` | MODIFY | Add `GATEWAY_EVENT`, `GATEWAY_STATUS`, `GITHUB_WEBHOOK_EVENT` to EventName + EventPayloads |
| 3 | `core/types/index.ts` | MODIFY | Re-export gateway-channel types |
| 4 | `src/entities/gateway-channels/types.ts` | CREATE | Re-exports from `core/types/gateway-channel` |
| 5 | `src/entities/gateway-channels/store.ts` | CREATE | Zustand store: channels record, connectionStatus, selectors, optimistic apply methods |
| 6 | `src/entities/gateway-channels/service.ts` | CREATE | CRUD + GatewayClient lifecycle management + webhook creation via GhCli |
| 7 | `src/entities/gateway-channels/listeners.ts` | CREATE | Routes `GATEWAY_EVENT` to typed `GITHUB_WEBHOOK_EVENT` events |
| 8 | `src/entities/gateway-channels/index.ts` | CREATE | Public exports for store, service, types |
| 9 | `src/entities/index.ts` | MODIFY | Import + call `setupGatewayChannelListeners()`, `gatewayChannelService.hydrate()`, `ensureGatewayChannelForRepo()` |

## Phases

- [x] Create gateway channel types in core/types
- [x] Add gateway event names to the events system
- [x] Implement Zustand store for gateway channels
- [x] Implement gateway channel service with GatewayClient lifecycle
- [x] Implement gateway channel listeners (event routing)
- [x] Integrate into entity hydration and listener setup

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Gateway Channel Types

### File: `core/types/gateway-channel.ts` (CREATE)

Define the Zod schema and derived type for gateway channel metadata. Follow the codebase convention: Zod schemas at trust boundaries (disk reads, network responses), with derived TypeScript types.

```typescript
import { z } from "zod";

export const GatewayChannelMetadataSchema = z.object({
  /** Stable ID: matches the server-side channelId (UUID) */
  id: z.string().uuid(),
  /** Channel type -- determines event routing */
  type: z.literal("github"),
  /** Human label (e.g. "owner/repo") */
  label: z.string().min(1),
  /** Whether this channel is currently active (receiving events) */
  active: z.boolean(),
  /** The webhook URL that external sources post to (contains unguessable channelId) */
  webhookUrl: z.string().url(),
  /** Associated repo entity ID */
  repoId: z.string().uuid().nullable().default(null),
  /** GitHub webhook ID for cleanup on delete */
  webhookId: z.number().nullable().default(null),
  /** Unix epoch milliseconds */
  createdAt: z.number(),
  /** Unix epoch milliseconds */
  updatedAt: z.number(),
});

export type GatewayChannelMetadata = z.infer<typeof GatewayChannelMetadataSchema>;
```

### File: `core/types/index.ts` (MODIFY)

Add a re-export line for the new gateway-channel types:

```typescript
// Gateway channel types - persisted channel metadata
export * from "./gateway-channel.js";
```

### File: `src/entities/gateway-channels/types.ts` (CREATE)

Standard entity types re-export pattern (matches `src/entities/repositories/types.ts`):

```typescript
/**
 * Gateway channel types - re-exported from core for consistency.
 * The canonical source of truth is @core/types/gateway-channel.js
 */
export {
  GatewayChannelMetadataSchema,
  type GatewayChannelMetadata,
} from "@core/types/gateway-channel.js";
```

---

## Phase 2: Gateway Event Names

### File: `core/types/events.ts` (MODIFY)

Add three new event names to the `EventName` const object. Place them in a new section after the existing groups:

```typescript
// In the EventName const:

// Gateway events
GATEWAY_EVENT: "gateway:event",
GATEWAY_STATUS: "gateway:status",
GITHUB_WEBHOOK_EVENT: "github:webhook-event",
```

Add corresponding payload types to the `EventPayloads` interface. Import `GatewayEvent` from the existing `gateway-events.ts` and `ConnectionStatus` from `core/gateway/client.ts`:

```typescript
// In EventPayloads:

// Gateway events
[EventName.GATEWAY_EVENT]: GatewayEvent;
[EventName.GATEWAY_STATUS]: { status: "disconnected" | "connecting" | "connected" };
[EventName.GITHUB_WEBHOOK_EVENT]: {
  channelId: string;
  githubEventType: string;
  payload: Record<string, unknown>;
};
```

Also add the new event names to the `EventNameSchema` z.enum array so they are recognized by the agent output protocol.

**Import additions at top of file:**
```typescript
import type { GatewayEvent } from "./gateway-events.js";
```

---

## Phase 3: Zustand Store

### File: `src/entities/gateway-channels/store.ts` (CREATE)

Follow the exact pattern from `src/entities/repositories/store.ts`: Zustand store with state, selectors, and optimistic apply methods returning `Rollback` functions.

**State shape:**
```typescript
interface GatewayChannelStoreState {
  channels: Record<string, GatewayChannelMetadata>;
  /** Gateway SSE connection status */
  connectionStatus: "disconnected" | "connecting" | "connected";
  _hydrated: boolean;
}
```

**Actions:**
```typescript
interface GatewayChannelStoreActions {
  /** Hydration (called once at app start) */
  hydrate: (channels: Record<string, GatewayChannelMetadata>) => void;

  /** Selectors */
  getChannel: (id: string) => GatewayChannelMetadata | undefined;
  getChannelByRepoId: (repoId: string) => GatewayChannelMetadata | undefined;
  getActiveChannels: () => GatewayChannelMetadata[];
  hasActiveChannels: () => boolean;

  /** Optimistic apply methods - return rollback functions */
  _applyCreate: (channel: GatewayChannelMetadata) => Rollback;
  _applyUpdate: (id: string, channel: GatewayChannelMetadata) => Rollback;
  _applyDelete: (id: string) => Rollback;

  /** Connection status */
  setConnectionStatus: (status: "disconnected" | "connecting" | "connected") => void;
}
```

**Key implementation details:**
- `getChannelByRepoId`: iterates `Object.values(channels)` and returns the first match on `repoId`. Return type is `| undefined`.
- `getActiveChannels`: filters to `channel.active === true`.
- `hasActiveChannels`: returns `getActiveChannels().length > 0`.
- Apply methods follow the exact rollback pattern from `src/entities/repositories/store.ts`.
- Keep under 250 lines.

---

## Phase 4: Service with GatewayClient Lifecycle

### File: `src/entities/gateway-channels/service.ts` (CREATE)

The service owns the singleton `GatewayClient` instance. It handles CRUD operations for channels, persists to disk, and manages the SSE connection lifecycle.

**Class API:**
```typescript
export class GatewayChannelService {
  /** Load all channel metadata from disk into store */
  async hydrate(): Promise<void>;

  /** Register a channel on the server, create GitHub webhook, and persist locally */
  async create(input: {
    deviceId: string;
    type: "github";
    label: string;
    repoId: string;
    repoRootPath: string;
  }): Promise<GatewayChannelMetadata>;

  /** Activate a channel. Connects GatewayClient if not already connected. */
  async activate(channelId: string): Promise<void>;

  /** Deactivate a channel. Disconnects GatewayClient if no active channels remain. */
  async deactivate(channelId: string): Promise<void>;

  /** Delete channel from disk, store, and clean up webhook */
  async delete(channelId: string): Promise<void>;

  /** Get a channel by ID (from store) */
  get(id: string): GatewayChannelMetadata | undefined;

  /** Get a channel by repo ID (from store) */
  getByRepoId(repoId: string): GatewayChannelMetadata | undefined;
}
```

**Storage layout (within `~/.mort/`):**
```
gateway-channels/{channelId}/
  metadata.json          <- GatewayChannelMetadata (Zod-validated on read)
gateway-channels/
  checkpoint             <- Last-Event-ID string for SSE replay on reconnect
```

**Hydration flow:**
1. List all directories under `gateway-channels/` (excluding `checkpoint`)
2. For each, read and Zod-validate `metadata.json`
3. Populate store via `useGatewayChannelStore.getState().hydrate(channels)`
4. If any channels have `active: true`, call `ensureConnected(deviceId)` to start the SSE client

**GatewayClient lifecycle (module-level singleton):**

```typescript
let gatewayClient: GatewayClient | null = null;

function ensureConnected(deviceId: string): void {
  if (gatewayClient) return;

  gatewayClient = new GatewayClient({
    baseUrl: GATEWAY_BASE_URL,
    deviceId,
    loadLastEventId: () => appData.readText("gateway-channels/checkpoint"),
    saveLastEventId: (id) => appData.writeText("gateway-channels/checkpoint", id),
    onEvent: (event) => eventBus.emit(EventName.GATEWAY_EVENT, event),
    onStatus: (status) => {
      useGatewayChannelStore.getState().setConnectionStatus(status);
      eventBus.emit(EventName.GATEWAY_STATUS, { status });
    },
  });

  gatewayClient.connect();
}

function disconnectIfIdle(): void {
  const anyActive = useGatewayChannelStore.getState().hasActiveChannels();
  if (!anyActive && gatewayClient) {
    gatewayClient.disconnect();
    gatewayClient = null;
  }
}
```

**`GATEWAY_BASE_URL`:** Define as a constant at the top of the service file: `const GATEWAY_BASE_URL = "https://mort-server.fly.dev";`. This is the same server that hosts the `/gateway/` routes, `/logs`, and `/identity` endpoints. Check `src/lib/constants.ts` for existing constant patterns and consider placing it there.

**Channel creation flow (`create` method):**

```typescript
// Channel registration HTTP call:
const response = await fetch(`${GATEWAY_BASE_URL}/gateway/channels`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ deviceId, type: "github", label: repoSlug }),
});

if (!response.ok) {
  throw new Error(`Failed to register gateway channel: ${response.status}`);
}

// Server returns { channelId: string, webhookUrl: string }
// Note: server uses "channelId", we store as "id" in local metadata
const { channelId, webhookUrl } = await response.json();

const metadata: GatewayChannelMetadata = {
  id: channelId,  // Map server's channelId to our id field
  type: "github",
  label: repoSlug,
  active: false,
  webhookUrl,
  repoId,
  webhookId: null, // Set after webhook creation
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
```

1. POST to gateway server `/gateway/channels` to register channel, get back `{ channelId, webhookUrl }`
2. Create GitHub webhook via `GhCli.createWebhook(webhookUrl, events)` -- the GhCli class is defined in the pr-entity plan (plan A). If GhCli is not yet implemented, stub the webhook creation step with a TODO comment and skip it gracefully.
3. Persist metadata to `gateway-channels/{channelId}/metadata.json`
4. Apply to store via `_applyCreate`

**Webhook events to subscribe to:**
```typescript
const GITHUB_WEBHOOK_EVENTS = [
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "issue_comment",
  "check_run",
  "check_suite",
];
```

**Channel deletion flow (`delete` method):**
1. If `webhookId` is set, call `GhCli.deleteWebhook(webhookId)` (best-effort, catch errors)
2. Remove from store via `_applyDelete`
3. Remove directory `gateway-channels/{channelId}/` from disk

**Keep the service under 250 lines.** If the GatewayClient lifecycle helpers push it over, extract them into a sibling `gateway-client-lifecycle.ts` file.

**Export a singleton:**
```typescript
export const gatewayChannelService = new GatewayChannelService();
```

---

## Phase 5: Listeners (Event Routing)

### File: `src/entities/gateway-channels/listeners.ts` (CREATE)

Routes raw gateway events into typed entity-specific events. This is a thin routing layer -- the actual event handling logic lives in the PR entity listeners (plan D2).

```typescript
import { eventBus } from "../events.js";
import { EventName } from "@core/types/events.js";
import type { GatewayEvent } from "@core/types/gateway-events.js";

export function setupGatewayChannelListeners(): void {
  eventBus.on(EventName.GATEWAY_EVENT, (event: GatewayEvent) => {
    if (event.type.startsWith("github.")) {
      eventBus.emit(EventName.GITHUB_WEBHOOK_EVENT, {
        channelId: event.channelId,
        githubEventType: event.type.replace("github.", ""),
        payload: event.payload,
      });
    }
  });
}
```

This is intentionally simple. The event type prefix (`github.`) comes from the gateway server, which prefixes channel-type to the original webhook event name.

### File: `src/entities/gateway-channels/index.ts` (CREATE)

Public exports:

```typescript
export { useGatewayChannelStore } from "./store";
export { gatewayChannelService } from "./service";
export type { GatewayChannelMetadata } from "./types";
export { setupGatewayChannelListeners } from "./listeners";
```

---

## Phase 6: Entity Integration

### File: `src/entities/index.ts` (MODIFY)

**Imports to add:**

```typescript
import { gatewayChannelService, setupGatewayChannelListeners } from "./gateway-channels";
```

**In `hydrateEntities()`:**

Add after the "Sync managed skills" block and before the final success log:

```typescript
// Hydrate gateway channels from disk
await gatewayChannelService.hydrate();
logger.log("[entities:hydrate] Gateway channels hydrated");

// Ensure a gateway channel exists for each repo (idempotent)
const repos = repoService.getAll();
for (const repo of repos) {
  try {
    await ensureGatewayChannelForRepo(repo);
  } catch (e) {
    // Non-fatal: channel creation failure is retried on next launch
    logger.error(`[entities:hydrate] Failed to ensure gateway channel for ${repo.name}:`, e);
  }
}
logger.log("[entities:hydrate] Gateway channels ensured for all repos");
```

**In `setupEntityListeners()`:**

Add the gateway channel listener setup:

```typescript
setupGatewayChannelListeners();
```

**`ensureGatewayChannelForRepo` helper:**

This can live in `src/entities/index.ts` or be extracted to `src/entities/gateway-channels/ensure-channel.ts` if `index.ts` gets too long. The function:

```typescript
async function ensureGatewayChannelForRepo(repo: Repository): Promise<void> {
  // Skip repos without a source path
  if (!repo.sourcePath) return;

  let channel = gatewayChannelService.getByRepoId(repoId);
  if (channel) {
    if (!channel.active) {
      await gatewayChannelService.activate(channel.id);
    }
    return;
  }

  // Need the repo's UUID from settings to use as repoId
  // Load settings to get the repo UUID
  const slug = repo.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const settings = await loadSettings(slug);
  const repoId = settings.id;

  // Check if gh CLI is available (GhCli defined in pr-entity plan)
  // If GhCli is not yet implemented, skip webhook creation and just register the channel
  const deviceId = getDeviceId(); // from settings or identity system

  const newChannel = await gatewayChannelService.create({
    deviceId,
    type: "github",
    label: repo.name,
    repoId,
    repoRootPath: repo.sourcePath,
  });

  await gatewayChannelService.activate(newChannel.id);
}
```

**`getDeviceId()` resolution:** The device identity is stored in `~/.mort/identity.json` (schema defined in `core/types/identity.ts`). The identity file is created on first launch by the Rust backend (`src-tauri/src/identity.rs`). To read it:

```typescript
import { appData } from "@/lib/app-data-store";
import { IdentitySchema } from "@core/types/identity.js";

async function getDeviceId(): Promise<string> {
  const raw = await appData.readJson("identity.json");
  const identity = IdentitySchema.parse(raw);
  return identity.device_id;
}
```

This reads the device ID from the same identity file used for other server-side operations. If the file doesn't exist (shouldn't happen in normal operation), throw an error -- the identity is created during app initialization before entity hydration runs.

---

## Verification

After implementation, verify:

1. **Types compile:** `npx tsc --noEmit` passes with the new types
2. **Store works:** Write a unit test that hydrates the store, creates a channel, and verifies selectors
3. **Service persists:** Write a unit test that creates a channel and verifies the metadata.json file is written to disk
4. **Listeners route events:** Write a unit test that emits a `GATEWAY_EVENT` with a `github.` prefixed type and verifies `GITHUB_WEBHOOK_EVENT` is emitted
5. **Hydration integrates:** Verify `hydrateEntities()` calls the gateway channel hydration without errors (even with zero channels)

Check the test patterns in `src/entities/threads/__tests__/` and `src/entities/threads/listeners.test.ts` for existing test conventions.

See [testing.md](../../docs/testing.md) for test commands and frameworks.
