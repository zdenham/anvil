# Second Box — Remote Dev Machine Content Pane

A new content pane that lets users provision, manage, and connect to remote dev machines directly from the Anvil UI — with zero ceremony. The user sees "a remote box"; all provider details (Fly Sprites) are hidden behind the Anvil backend.

## Context

**Backing provider** (server-side only): Fly Sprites — persistent Linux microVMs with 100GB storage, up to 8 CPU / 16GB RAM, WebSocket terminal access, auto-sleep after 30s idle, instant wake. Pre-installed: Claude Code, Python 3.13, Node 22.

**Key constraint**: The Sprites API token lives on the server (`anvil-server.fly.dev`) as an env var. The desktop app never sees it. All provisioning flows through the Anvil backend, which proxies requests to Sprites. From the user's perspective, they're just creating a remote environment — no tokens, no provider config.

**Auth**: The desktop app already identifies itself via `device_id` (UUID from `~/.config/anvil/app-config.json`). Remote box API calls include this device_id so the server can scope boxes per device.

**Internal naming**: "remote box" / "second box" / `RemoteBox` — never "sprite".

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Desktop App (Tauri + React)                            │
│                                                         │
│  Content Pane: "second-box"                             │
│   ├─ List/provision view → fetch("/remote-boxes/...")   │
│   └─ Connected view → xterm.js ↔ WebSocket             │
│                                                         │
│  Three-dot menu → "Second Box" → opens content pane     │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP + WebSocket
                       ▼
┌─────────────────────────────────────────────────────────┐
│  anvil-server.fly.dev                                    │
│                                                         │
│  /remote-boxes/* (new Fastify plugin)                   │
│   ├─ POST   /remote-boxes          → create box         │
│   ├─ GET    /remote-boxes          → list boxes         │
│   ├─ GET    /remote-boxes/:name    → get status         │
│   ├─ DELETE /remote-boxes/:name    → destroy box        │
│   └─ WS     /remote-boxes/:name/exec → terminal proxy  │
│                                                         │
│  Provider adapter layer (server-side only):             │
│   ├─ BoxProvider interface (abstract contract)          │
│   └─ SpritesProvider (implements BoxProvider)           │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
              Provider API (e.g. api.sprites.dev)
```

### Data Flow

```
User clicks "Second Box" in three-dot menu
  → navigationService.navigateToView({ type: "second-box" })
  → Content pane fetches box list from Anvil backend

User provisions a box → POST /remote-boxes { name, device_id }
  → Server calls provider.create() → returns metadata
  → Client saves metadata to ~/.anvil/remote-boxes/{name}.json
  → Auto-connect: open WebSocket terminal

User connects → WS /remote-boxes/{name}/exec?device_id=...&rows=R&cols=C
  → Server calls provider.buildExecUrl() → gets upstream WS URL
  → Server pipes: client ↔ server ↔ provider (transparent proxy)
  → xterm.js ↔ WebSocket (no Rust PTY involved)

User types → ws.send(keystroke) → server proxy → provider → response → xterm.write()
```

## Phases

- [ ] Phase 1: Server — remote-boxes Fastify plugin + BoxProvider interface + Sprites adapter

- [ ] Phase 2: Client entity layer — RemoteBox service, store, types, API client

- [ ] Phase 3: Content pane — "second-box" view type, provisioning UI, WebSocket terminal

- [ ] Phase 4: Entry point — "Second Box" item in three-dot menu dropdown

- [ ] Phase 5: Auto-setup — push SSH keys + git config on first connect

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Server — Remote Boxes Plugin

New Fastify plugin registered in `server/src/app.ts` under `/remote-boxes` prefix.

### BoxProvider Interface (server-side)

`server/src/remote-boxes/provider.ts`

Abstract contract that all provider adapters implement. Routes and plugin code **only** depend on this interface — never on a concrete provider.

```typescript
export interface BoxInfo {
  name: string;
  status: "cold" | "running" | "creating" | "error";
  createdAt: number;
}

export interface BoxProvider {
  create(name: string): Promise<BoxInfo>;
  destroy(name: string): Promise<void>;
  get(name: string): Promise<BoxInfo>;
  list(): Promise<BoxInfo[]>;
  buildExecUrl(name: string, opts: { rows: number; cols: number }): string;
  writeFile(name: string, path: string, content: string): Promise<void>;
}
```

### Sprites Adapter

`server/src/remote-boxes/adapters/sprites.ts`

- **Only file** that knows about Sprites URLs/terminology
- Implements `BoxProvider`
- Reads `SPRITES_API_TOKEN` from env
- Maps Sprites-specific response shapes → `BoxInfo`
- `create(name)` → POST `https://api.sprites.dev/v1/sprites`
- `destroy(name)` → DELETE `https://api.sprites.dev/v1/sprites/{name}`
- `get(name)` → GET `https://api.sprites.dev/v1/sprites/{name}`
- `list()` → GET `https://api.sprites.dev/v1/sprites`
- `buildExecUrl(name, opts)` → WSS URL string with bearer token as query param
- `writeFile(name, path, content)` → Sprites filesystem API

To add a new provider later, create a new file in `adapters/` that implements `BoxProvider` and swap the factory.

### Provider Factory

`server/src/remote-boxes/adapters/index.ts`

```typescript
import { BoxProvider } from "../provider.js";
import { SpritesProvider } from "./sprites.js";

export function createProvider(): BoxProvider {
  // Currently only Sprites — add env-based selection here later
  return new SpritesProvider();
}
```

### Routes

`server/src/remote-boxes/routes.ts`

Routes receive a `BoxProvider` instance — they never import or reference any concrete adapter. All endpoints require `device_id` (query param or header) to scope boxes per device.

**REST endpoints:**

| Method | Path | Description |
| --- | --- | --- |
| `POST /remote-boxes` | `{ name, device_id }` | Create a box. Server prefixes name with device_id fragment to avoid collisions. |
| `GET /remote-boxes` | `?device_id=...` | List boxes for this device. |
| `GET /remote-boxes/:name` | `?device_id=...` | Get box status. |
| `DELETE /remote-boxes/:name` | `?device_id=...` | Destroy a box. |
| `POST /remote-boxes/:name/setup` | `{ device_id, publicKey, privateKey, gitUser, gitEmail }` | Push SSH keys + git config to box via `provider.writeFile()`. |

**WebSocket endpoint:**

`GET /remote-boxes/:name/exec` (upgrade to WebSocket)

- Query params: `device_id`, `rows`, `cols`
- Server calls `provider.buildExecUrl()` to get the upstream WebSocket URL
- Pipes bidirectionally: client ↔ server ↔ provider
- On upstream close, closes client connection (and vice versa)
- Latency cost is minimal — server is on Fly, close to provider infra

### Plugin Registration

`server/src/remote-boxes/index.ts`

```typescript
import { createProvider } from "./adapters/index.js";

export const remoteBoxesPlugin: FastifyPluginAsync = async (fastify) => {
  const provider = createProvider();
  // Register routes, passing provider instance
};
```

In `server/src/app.ts`:

```typescript
await fastify.register(remoteBoxesPlugin, { prefix: "/remote-boxes" });
```

### Naming Convention

To avoid collisions across devices, the server prefixes box names: `{device_id_prefix}-{user_name}` (e.g., `a1b2c3-my-box`). The client never sees the prefix — the server strips it in responses.

## Phase 2: Client Entity Layer

### Types

`src/entities/remote-boxes/types.ts`

```typescript
import { z } from "zod";

export const RemoteBoxMetadataSchema = z.object({
  name: z.string(),
  status: z.enum(["cold", "running", "creating", "error"]),
  createdAt: z.number(),
  lastConnectedAt: z.number().optional(),
  setupComplete: z.boolean(), // SSH key + git config pushed
});

export type RemoteBoxMetadata = z.infer<typeof RemoteBoxMetadataSchema>;
```

### API Client

`src/lib/remote-box-api.ts`

- Talks to `https://anvil-server.fly.dev/remote-boxes/*`
- All requests include `device_id` from app config (via Tauri `invoke("get_device_id")`)
- `create(name: string)` → POST /remote-boxes
- `destroy(name: string)` → DELETE /remote-boxes/:name
- `list()` → GET /remote-boxes
- `getStatus(name: string)` → GET /remote-boxes/:name
- `buildExecWsUrl(name, opts: { rows, cols })` → builds `wss://anvil-server.fly.dev/remote-boxes/{name}/exec?device_id=...&rows=...&cols=...`
- `setup(name, opts: { publicKey, privateKey, gitUser, gitEmail })` → POST /remote-boxes/:name/setup

No tokens stored client-side. The device_id is the only identifier needed.

### Service

`src/entities/remote-boxes/service.ts`

- `RemoteBoxService` class
- `create(name: string)` — calls API client, saves metadata to `~/.anvil/remote-boxes/{name}.json`
- `destroy(name: string)` — calls API client, removes local metadata
- `list()` — fetches from API, syncs with local metadata
- `getStatus(name: string)` — fetches current status from API
- `getExecWsUrl(name, opts: { rows, cols })` — delegates to API client
- Reads device_id from app config

### Store

`src/entities/remote-boxes/store.ts`

- Zustand store: `useRemoteBoxStore`
- `boxes: Record<string, RemoteBoxMetadata>`
- `hydrate()` from disk on startup
- Optimistic updates with rollback

`src/entities/remote-boxes/index.ts` — public exports

## Phase 3: Content Pane — "second-box" View

### ContentPaneView Update

In `src/components/content-pane/types.ts`, add:

```typescript
| { type: "second-box" }
```

### Pane Layout Schema

In `core/types/pane-layout.ts`, add `"second-box"` to the view type discriminated union so it persists across sessions.

### Component: SecondBoxContent

`src/components/content-pane/second-box-content.tsx`

Stateful pane that manages its own internal navigation:

**State 1 — Box list + provisioning (default):**

```
┌──────────────────────────────────────────┐
│  Your Boxes                              │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │ my-box       ● running    [Connect] │ │
│  │ dev-box      ○ sleeping   [Connect] │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │ Name: [my-box_______]   [Create]    │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

**State 2 — Connected to a box:**

```
┌──────────────────────────────────────────┐
│ my-box • ● running   [← Back] [Delete]  │
├──────────────────────────────────────────┤
│                                          │
│  xterm.js ↔ WebSocket terminal           │
│  (full TTY, resize, scrollback)          │
│                                          │
└──────────────────────────────────────────┘
```

No "no token configured" state needed — auth is automatic via device_id.

### Terminal Implementation

When connected to a box:

- Open WebSocket to `wss://anvil-server.fly.dev/remote-boxes/{name}/exec?device_id=...&rows=R&cols=C`
- Server proxies to provider — client never sees provider details
- Pipe: `ws.onmessage → terminal.write()`, `terminal.onData → ws.send()`
- Resize: reconnect WebSocket with new dimensions (or in-band resize if server supports forwarding)
- Auto-reconnect on WebSocket close with exponential backoff
- Reuse `ANVIL_TERMINAL_THEME` and same xterm.js config as local terminals
- Connection state overlay: "Waking box..." / "Connecting..." / "Connected"

### Register in ContentPane

In `content-pane.tsx`:

```tsx
{view.type === "second-box" && <SecondBoxContent />}
```

### Tab Label

In `use-tab-label.ts`:

```typescript
case "second-box":
  return "Second Box";
```

## Phase 4: Entry Point — Three-Dot Menu

### MenuDropdown Changes

In `src/components/tree-menu/menu-dropdown.tsx`:

1. Add `onSecondBoxClick` to `MenuDropdownProps`
2. Add menu item:

```typescript
{ id: "second-box", label: "Second Box", icon: <Monitor size={11} />, onClick: onSecondBoxClick },
```

Position above Settings.

### TreePanelHeader Wiring

In `src/components/tree-menu/tree-panel-header.tsx`:

```typescript
onSecondBoxClick={() => navigationService.navigateToView({ type: "second-box" })}
```

### Navigation

Existing `navigateToView` fallthrough handles `"second-box"` — no changes needed.

## Phase 5: Auto-Setup (SSH + Git Config)

On **first connection** to a box (when `setupComplete === false`):

### SSH Keypair

`src/lib/remote-box-ssh.ts`

- `generateKeypair()` — runs `ssh-keygen -t ed25519 -f ~/.anvil/remote-boxes/id_ed25519 -N "" -C "anvil-second-box"` via Tauri shell
- `getPublicKey()` — reads `~/.anvil/remote-boxes/id_ed25519.pub`
- `getPrivateKey()` — reads `~/.anvil/remote-boxes/id_ed25519`
- Generated once, reused for all boxes

### Setup Flow

1. Generate SSH keypair locally (if not exists)
2. Read local git identity (`git config user.name`, `git config user.email`)
3. Call `POST /remote-boxes/{name}/setup` with `{ publicKey, privateKey, gitUser, gitEmail }`
4. Server pushes files to box via `provider.writeFile()`:
   - Public key → `/root/.ssh/authorized_keys` (mode 0600)
   - Private key → `/root/.ssh/id_ed25519` (mode 0600, for outbound git)
   - SSH config → `/root/.ssh/config`
   - Git config → `/root/.gitconfig`
5. Mark `setupComplete = true` in local metadata

User sees "Setting up your box..." overlay for \~2 seconds, then drops into a ready terminal.

## File Summary

### New Files — Server

| File | Purpose |
| --- | --- |
| `server/src/remote-boxes/index.ts` | Fastify plugin registration |
| `server/src/remote-boxes/routes.ts` | REST + WebSocket routes (depends only on `BoxProvider` interface) |
| `server/src/remote-boxes/provider.ts` | `BoxProvider` interface + `BoxInfo` type |
| `server/src/remote-boxes/adapters/index.ts` | Provider factory (`createProvider()`) |
| `server/src/remote-boxes/adapters/sprites.ts` | Sprites adapter (implements `BoxProvider`) |
| `server/src/remote-boxes/types.ts` | Request/response Zod schemas |

### New Files — Client

| File | Purpose |
| --- | --- |
| `src/entities/remote-boxes/types.ts` | Zod schema + TypeScript types |
| `src/entities/remote-boxes/service.ts` | CRUD, lifecycle, disk persistence |
| `src/entities/remote-boxes/store.ts` | Zustand store |
| `src/entities/remote-boxes/index.ts` | Public exports |
| `src/lib/remote-box-api.ts` | HTTP client to anvil-server.fly.dev |
| `src/lib/remote-box-ssh.ts` | SSH keypair generation + management |
| `src/components/content-pane/second-box-content.tsx` | Content pane (list + terminal) |

### Modified Files

| File | Change |
| --- | --- |
| `server/src/app.ts` | Register remoteBoxesPlugin |
| `src/components/content-pane/types.ts` | Add `{ type: "second-box" }` to ContentPaneView |
| `src/components/content-pane/content-pane.tsx` | Add render case |
| `core/types/pane-layout.ts` | Add to Zod schema for persistence |
| `src/components/split-layout/use-tab-label.ts` | Add tab label |
| `src/components/tree-menu/menu-dropdown.tsx` | Add "Second Box" menu item |
| `src/components/tree-menu/tree-panel-header.tsx` | Wire up onSecondBoxClick callback |

## Open Questions

1. **WebSocket proxy latency**: Server proxies terminal WebSocket through Fly. Since both server and provider are co-located on Fly infra, latency should be negligible — but worth validating.
2. **Resize protocol**: Confirm whether the Sprites exec WebSocket supports in-band resize messages or requires reconnection with new dimensions. The `BoxProvider` interface should accommodate either approach.
3. **Box naming/scoping**: Using `device_id` prefix to scope boxes. Should we also allow a GitHub handle-based scope for users who switch devices?
4. **Rate limiting**: Should the server enforce per-device box limits (e.g., max 3 boxes per device)?
5. **Provider selection**: Currently hardcoded to Sprites via `createProvider()`. When we add a second provider, decide whether selection is per-server env var, per-device config, or per-box.