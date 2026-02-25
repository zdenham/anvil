# Fix: "No gateway channel found for repo" in PrAutoAddressToggle

## Problem

When toggling auto-address on a PR, the toggle silently fails with:

```
[PrAutoAddressToggle] No gateway channel found for repo 5ccb3140-cb46-443d-be8b-ad212d6f3fc5
```

The error repeats on every click. The toggle appears interactive but does nothing.

## Root Cause

The `PrAutoAddressToggle` component calls `gatewayChannelService.getByRepoId(repoId)` at click time (line 37 of `pr-auto-address-toggle.tsx`). This does a linear scan of the gateway channel store looking for a channel whose `repoId` matches.

The channel store is **empty** because `ensureGatewayChannelForRepo()` failed during hydration. The failure was caused by the Tauri HTTP plugin issue documented in `plans/fix-gateway-channel-load-failed.md` — the `fetch()` POST to register the channel on the gateway server was blocked by Tauri v2's network isolation.

The fix from that plan has been partially applied:
- `@tauri-apps/plugin-http` is installed and `import { fetch } from "@tauri-apps/plugin-http"` is present in both `service.ts` and `gateway-client-lifecycle.ts`
- The Tauri HTTP plugin is registered in `lib.rs`
- HTTP permissions are configured in `capabilities/default.json`

However, the channel creation still fails silently during hydration. The error is caught at `src/entities/index.ts:181` and logged, but there is **no retry and no fallback**. Once hydration passes, there's no way to create the channel later.

This means the toggle will **never work** for any repo whose channel creation failed at startup, which based on the logs is every repo.

## Investigation Chain

1. `pr-auto-address-toggle.tsx:37` — calls `gatewayChannelService.getByRepoId(repoId)`
2. `gateway-channels/store.ts:55-58` — `Object.values(channels).find(ch => ch.repoId === repoId)` — returns `undefined` because `channels` is empty
3. `gateway-channels/service.ts:76-129` — `create()` registers channel on gateway server via HTTP POST
4. `entities/index.ts:178-185` — `ensureGatewayChannelForRepo()` is called during hydration, errors are caught and logged
5. `gateway-channels/ensure-channel.ts:36-67` — orchestrates the channel creation flow
6. `gateway-channels/service.ts:86` — `fetch()` POST to gateway server — this is the call that fails

## Entity vs Connection — Idempotency Requirements

There are **two separate concerns** that must both be satisfied for the toggle to work:

1. **Channel entity** — the metadata record in the Zustand store (and persisted to disk) linking a repo to a gateway channel ID, webhook URL, etc. Checked via `getByRepoId()`.
2. **Channel connection** — the GatewayClient SSE singleton that streams events from the gateway server. Managed by `gateway-client-lifecycle.ts`.

These are independent. A channel entity can exist in the store while the SSE connection is disconnected (or was never established). `getByRepoId()` only checks the store — it tells you nothing about connection state.

### Failure scenarios

| Scenario | Entity exists? | Connection alive? | `getByRepoId` returns? |
|---|---|---|---|
| Hydration failed completely | No | No | `undefined` |
| Entity exists, inactive, no connection | Yes | No | Entity (with `active: false`) |
| Entity exists, active, connection dropped | Yes | No | Entity (with `active: true`) |
| Entity exists, active, connected | Yes | Yes | Entity |

The fix must be **idempotent across all four cases**. The existing `ensureGatewayChannelForRepo` already handles cases 2-4 correctly (it activates inactive channels, and `activate()` calls `ensureConnected()`). But the proposed `ensureGatewayChannelByRepoId` helper must not short-circuit on entity existence alone — it must also ensure the channel is active and the connection is established.

## Fix Strategy

The toggle should ensure a channel exists, is active, and has a live connection **at click time**, rather than depending entirely on hydration having succeeded. This makes the system resilient to transient startup failures and mid-session connection drops.

The key insight: `ensureGatewayChannelForRepo` already handles all four scenarios correctly — it creates if missing, activates if inactive, and `activate()` calls `ensureConnected()`. The new `ensureGatewayChannelByRepoId` wrapper just needs to always delegate to it (not short-circuit on entity existence).

## Phases

- [x] Add idempotent `ensureGatewayChannelByRepoId` helper that handles all four scenarios
- [x] Use the helper in PrAutoAddressToggle for on-demand channel creation + connection
- [x] Add diagnostic logging to identify why hydration-time creation is failing
- [x] Add user-visible feedback when channel creation fails

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: Idempotent `ensureGatewayChannelByRepoId` helper

**`src/entities/gateway-channels/ensure-channel.ts`** — add a new export:

```typescript
/**
 * Ensure a gateway channel exists, is active, and has a live connection
 * for a repo identified by its settings ID.
 *
 * Idempotent across all states:
 * - No entity → creates channel, activates, connects
 * - Entity inactive → activates, connects
 * - Entity active but disconnected → re-ensures connection
 * - Entity active and connected → no-op
 *
 * Unlike ensureGatewayChannelForRepo (which takes a Repository), this takes
 * a repoId and resolves the repo internally. Used for on-demand creation
 * when hydration-time creation failed or connection dropped.
 */
export async function ensureGatewayChannelByRepoId(repoId: string): Promise<GatewayChannelMetadata | null> {
  // Always delegate to ensureGatewayChannelForRepo — it handles all four states
  // (missing, inactive, active-but-disconnected, fully-connected).
  // Do NOT short-circuit on getByRepoId() returning truthy — that only checks
  // entity existence, not connection state.

  // Find the repo whose settings.id matches this repoId
  const repos = repoService.getAll();
  for (const repo of repos) {
    if (!repo.sourcePath) continue;
    const slug = slugify(repo.name);
    const settings = await loadSettings(slug);
    if (settings.id === repoId) {
      await ensureGatewayChannelForRepo(repo);
      return gatewayChannelService.getByRepoId(repoId) ?? null;
    }
  }

  logger.error(`[ensureGatewayChannelByRepoId] No repo found for repoId ${repoId}`);
  return null;
}
```

**Why no short-circuit:** The original plan had `if (existing) return existing;` at the top. This is wrong — it would return a channel entity that might be inactive or disconnected. Instead, we always call `ensureGatewayChannelForRepo` which internally handles all four states:

- `ensure-channel.ts:46-50`: If entity exists and is active → returns (and `activate()` was already called, which called `ensureConnected()`)
- `ensure-channel.ts:47-49`: If entity exists but inactive → calls `activate()` → `ensureConnected()`
- `ensure-channel.ts:53-63`: If no entity → creates, activates, connects

**One remaining gap:** If the entity is active but `ensureConnected` was already called (so GatewayClient singleton exists), but the connection actually dropped, the current `ensureConnected` is a no-op (`if (gatewayClient) return`). The GatewayClient's internal reconnect logic with exponential backoff handles this — we don't need to force a reconnect. But we should note this: if the gateway server is permanently unreachable, the toggle will succeed in creating/activating the channel but events won't flow until the connection recovers.

### Phase 2: Use the helper in PrAutoAddressToggle

**`src/components/content-pane/pr-auto-address-toggle.tsx`** — modify the `handleToggle` callback:

```typescript
// Always ensure channel exists, is active, and connection is established.
// This is idempotent — no-op if everything is already set up.
const channel = await ensureGatewayChannelByRepoId(repoId);
if (!channel) {
  logger.error(`[PrAutoAddressToggle] Could not ensure gateway channel for repo ${repoId}`);
  setError("Could not connect to gateway — check your connection and try again");
  return;
}

// Channel is guaranteed to exist, be active, and have a connection attempt in progress
await pullRequestService.enableAutoAddress(prId, channel.id);
```

Note: this replaces the current pattern of `getByRepoId` + bail. Every toggle click now goes through the idempotent ensure path, which is cheap when everything is already set up (just a store lookup + early return).

### Phase 3: Diagnostic logging

The current hydration error logging is too sparse — we just see the outer catch. Add more targeted logging inside `ensureGatewayChannelForRepo` and `GatewayChannelService.create()`:

**`src/entities/gateway-channels/ensure-channel.ts`** — add logging around each step:

```typescript
logger.info(`[ensureGatewayChannelForRepo] Starting for ${repo.name} (repoId=${repoId})`);
```

**`src/entities/gateway-channels/service.ts`** — log the fetch URL and response status:

```typescript
logger.info(`[GatewayChannelService.create] POST ${GATEWAY_BASE_URL}/gateway/channels`);
// ... after response:
logger.info(`[GatewayChannelService.create] Response: ${response.status}`);
```

This will help diagnose whether the issue is:
- Tauri HTTP plugin still not working (fetch throws)
- Gateway server returning errors (non-200 status)
- Webhook creation failing (gh CLI issue)
- Settings ID mismatch (repoId doesn't match any channel)

### Phase 4: User-visible feedback

Currently the toggle just silently returns on failure. Add minimal feedback:

**`pr-auto-address-toggle.tsx`** — add an error state:

```typescript
const [error, setError] = useState<string | null>(null);
```

In the catch/failure paths, set the error. Render it below the toggle description:

```typescript
{error && (
  <div className="text-xs text-red-400 mt-1">{error}</div>
)}
```

Clear the error on successful toggle. Use brief, actionable messages like:
- "Could not connect to gateway — check your connection and try again"
- "GitHub CLI not available — install gh and authenticate"
