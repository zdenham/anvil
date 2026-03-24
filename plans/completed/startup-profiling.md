# Startup Profiling: Add Timing Instrumentation

Add `performance.now()` timing to every step in the startup path so we can identify the biggest contributors to the loading screen delay. No behavior changes — just measurement.

## Context

The app shows a "Loading..." screen (`src/App.tsx:111-117`) between:
1. React mount → `appState` transitions to `"ready"` (onboarding/permissions check)
2. `"ready"` → `isHydrated = true` (bootstrap + entity hydration)

The Rust side also has blocking work before the window even appears (migrations, panel creation, etc.).

## Phases

- [x] Add timing to Rust startup (`src-tauri/src/lib.rs` setup closure)
- [x] Add timing to frontend bootstrap (`src/App.tsx` bootstrap function)
- [x] Add timing to entity hydration (`src/entities/index.ts` hydrateEntities)
- [x] Add timing to syncManagedSkills (`src/lib/skill-sync.ts`)
- [x] Add timing to gateway channel hydration and ensureGatewayChannelForRepo loop
- [x] Add a startup summary log that shows total time and top contributors

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Rust startup timing (`src-tauri/src/lib.rs`)

Wrap each step in the `.setup()` closure (lines 1010–1161) with `std::time::Instant`:

```rust
let t0 = std::time::Instant::now();
// ... step ...
tracing::info!(elapsed_ms = t0.elapsed().as_millis(), "startup: <step name>");
```

Steps to instrument (in order of execution):
- `ensure_anvil_directories()`
- `hub.start()` (AgentHub socket)
- `logging::set_app_handle()`
- `config::initialize()`
- `run_ts_migrations(app)` — likely the single biggest contributor
- `panels::initialize()` + each `panels::create_*_panel()`
- Menu + tray init
- `icons::initialize()`, `app_search::initialize()`, `clipboard::initialize()`
- Hotkey registration
- `window.show()`

Also add a total for the full `.setup()` closure:
```rust
let setup_start = std::time::Instant::now();
// ... all setup steps ...
tracing::info!(total_ms = setup_start.elapsed().as_millis(), "startup: setup() complete");
```

## Phase 2: Frontend bootstrap timing (`src/App.tsx`)

Add `performance.now()` timing around the bootstrap function (lines 64–73):

```ts
async function bootstrap() {
  const t0 = performance.now();

  const tResize = performance.now();
  await window.setSize(new LogicalSize(900, 600));
  logger.info(`[startup] window.setSize: ${(performance.now() - tResize).toFixed(0)}ms`);

  const tBootstrap = performance.now();
  await bootstrapAnvilDirectory();
  logger.info(`[startup] bootstrapAnvilDirectory: ${(performance.now() - tBootstrap).toFixed(0)}ms`);

  const tHydrate = performance.now();
  await hydrateEntities();
  logger.info(`[startup] hydrateEntities: ${(performance.now() - tHydrate).toFixed(0)}ms`);

  const tListeners = performance.now();
  setupEntityListeners();
  logger.info(`[startup] setupEntityListeners: ${(performance.now() - tListeners).toFixed(0)}ms`);

  const tAgent = performance.now();
  await initAgentMessageListener();
  logger.info(`[startup] initAgentMessageListener: ${(performance.now() - tAgent).toFixed(0)}ms`);

  setIsHydrated(true);
  logger.info(`[startup] bootstrap total: ${(performance.now() - t0).toFixed(0)}ms`);
}
```

Also time the `checkInitialState()` function in the first useEffect (lines 27–55) — specifically `isOnboarded()` and `checkAccessibilityPermission()`.

## Phase 3: Entity hydration timing (`src/entities/index.ts`)

Inside `hydrateEntities()` (lines 140–222), wrap each phase with timing. Use a helper to keep it clean:

```ts
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  const result = await fn();
  logger.info(`[startup:hydrate] ${label}: ${(performance.now() - t).toFixed(0)}ms`);
  return result;
}
```

Instrument each step:
1. Core entities parallel (`Promise.all` of thread/repo/settings/plan/relation) — time the whole block + each individual service
2. `relationService.cleanupOrphaned()`
3. `planService.refreshParentRelationships()` loop
4. `useRepoWorktreeLookupStore.hydrate()`
5. `treeMenuService.hydrate()`
6. `quickActionService.hydrate()`
7. `draftService.hydrate()`
8. `pullRequestService.hydrate()`
9. `syncManagedSkills()`
10. `gatewayChannelService.hydrate()`
11. `ensureGatewayChannelForRepo` loop (time entire loop + per-repo)

For the core entities parallel block, time each individual service AND the `Promise.all` total, so we know if one service is the bottleneck:

```ts
await timed("core entities (parallel)", () => Promise.all([
  timed("threadService.hydrate", () => threadService.hydrate()),
  timed("repoService.hydrate", () => repoService.hydrate()),
  timed("settingsService.hydrate", () => settingsService.hydrate()),
  timed("planService.hydrate", () => planService.hydrate()),
  timed("relationService.hydrate", () => relationService.hydrate()),
]));
```

## Phase 4: Skill sync timing (`src/lib/skill-sync.ts`)

Inside `syncManagedSkills()` (lines 14–41):
- Time `getBundledPluginPath()` + `getAnvilDir()` resolution
- Time plugin.json copy
- Time the entire skills directory loop + each `copySkillDirectory()` call with the skill name

## Phase 5: Gateway channel timing

In `hydrateEntities()`, the gateway section (lines 197–212) needs:
- Time `gatewayChannelService.hydrate()` separately
- Time the `ensureGatewayChannelForRepo` loop total
- Log per-repo time so we can see if one repo's API call is slow

## Phase 6: Startup summary

After `setIsHydrated(true)` in `App.tsx`, log a summary:
```
[startup] === STARTUP COMPLETE ===
[startup] checkInitialState: Xms
[startup] bootstrap total: Xms
[startup]   bootstrapAnvilDirectory: Xms
[startup]   hydrateEntities: Xms
[startup]   setupEntityListeners: Xms
```

Use `logger.info` with `[startup]` prefix consistently so logs are easy to grep.

## Conventions

- **Rust**: Use `std::time::Instant` + `tracing::info!` with `elapsed_ms` field
- **TypeScript**: Use `performance.now()` + `logger.info()` with `[startup]` prefix
- No `console.log` — use `logger` everywhere per project conventions
- Keep the timing code minimal — local `timed()` helper, no new files or abstractions
- All timing is unconditional (always on) — this is lightweight enough to ship
