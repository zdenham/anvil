# Visible-Thread Event Filtering

## Problem

The agent→frontend event pipeline floods faster than the frontend can consume. In a 12-minute session: 508 sequence gaps, 1,407 events dropped, broadcast channel (capacity 1024) overflows, frontend frame rate degrades from 19.6 → 0.7 FPS, leading to WebKit network process crash.

Currently, **all** agent events are broadcast to **all** WS clients regardless of which thread the user is viewing. The broadcast channel in `push.rs` is all-or-nothing — no topic filtering.

## Approach

Implement a **visibility-aware event gate**: only emit high-frequency "display" events for threads the user is actively viewing. Lifecycle events always emit.

### Event Classification

**Heuristic: does this event affect the sidebar tree?** If yes → lifecycle (always emit). If no → display (gate by visibility).

The sidebar tree renders threads, plans, terminals, PRs, and folders. It derives status dots from thread status + pending permission/question state. Any event that creates, updates, removes, or changes the visual state of a sidebar node is lifecycle.

**Always-emit (lifecycle)** — sidebar-affecting events:

| Category | Events |
|----------|--------|
| Thread tree nodes | `THREAD_OPTIMISTIC_CREATED`, `THREAD_CREATED`, `THREAD_UPDATED`, `THREAD_STATUS_CHANGED`, `THREAD_ARCHIVED`, `THREAD_NAME_GENERATED` |
| Pending input (yellow dot) | `PERMISSION_REQUEST`, `QUESTION_REQUEST` — drive `threadsWithPendingInput` → `"needs-input"` status variant via `getThreadStatusVariant()` |
| Plan tree nodes | `PLAN_DETECTED`, `PLAN_CREATED`, `PLAN_UPDATED`, `PLAN_ARCHIVED` |
| PR tree nodes | `PR_DETECTED`, `PR_CREATED`, `PR_UPDATED`, `PR_ARCHIVED` |
| Terminal tree nodes | `TERMINAL_CREATED`, `TERMINAL_UPDATED`, `TERMINAL_ARCHIVED` |
| Folder tree nodes | `FOLDER_CREATED`, `FOLDER_UPDATED`, `FOLDER_DELETED`, `FOLDER_ARCHIVED` |
| Worktree/repo grouping | `WORKTREE_ALLOCATED`, `WORKTREE_RELEASED`, `WORKTREE_NAME_GENERATED`, `WORKTREE_SYNCED`, `REPOSITORY_CREATED`, `REPOSITORY_UPDATED`, `REPOSITORY_DELETED` |
| Sidebar relationships | `RELATION_CREATED`, `RELATION_UPDATED` |
| Global state | `SETTINGS_UPDATED`, `API_DEGRADED` |

**Visibility-gated (display)** — everything else. The high-volume offenders are `STREAM_DELTA`, `THREAD_ACTION`, and `QUEUED_MESSAGE_ACK`, but this also includes lower-frequency thread-scoped events like `AGENT_SPAWNED`, `AGENT_COMPLETED`, `AGENT_ERROR`, `AGENT_CANCELLED`, `AGENT_TOOL_COMPLETED`, `THREAD_FILE_CREATED`, `THREAD_FILE_MODIFIED`, `COMMENT_*`, `USER_MESSAGE_SENT`, `ACTION_REQUESTED`, `PERMISSION_RESPONSE`, `QUESTION_RESPONSE`, `PERMISSION_MODE_CHANGED`, `GATEWAY_EVENT`, `GATEWAY_STATUS`, `GITHUB_WEBHOOK_EVENT`.

**Implementation: define `LIFECYCLE_EVENTS` set, gate everything not in it.** This is more maintainable than enumerating display events — new event types default to display (gated) unless explicitly added to the lifecycle set, which is the safe default.

### Architecture: File-Watched Pane Layout with Shared Core Logic

The pane layout is **already persisted** to `~/.anvil/ui/pane-layout.json` on every mutation (tab open, close, switch, split, move) by `pane-layout/service.ts → persistState()`. The file contains the full split-tree with all groups and their active tabs — everything needed to derive visible thread IDs.

#### Shared extraction logic in `core/`

The visible-thread extraction logic currently lives in `src/stores/pane-layout/store.ts` as `getVisibleThreadIds()`, tightly coupled to the Zustand store. We'll extract the **pure logic** into `core/lib/pane-layout.ts` so both frontend and agents can use it:

- Move `PaneLayoutPersistedStateSchema` and its dependencies (`ContentPaneViewSchema`, `TabItemSchema`, `PaneGroupSchema`, `SplitNodeSchema`, `TerminalPanelStateSchema`) from `src/stores/pane-layout/types.ts` and `src/stores/content-panes/types.ts` into `core/types/pane-layout.ts`
- **Update all imports directly** — no re-exports from the old locations. Every file that imported these schemas/types from `src/stores/pane-layout/types` or `src/stores/content-panes/types` gets updated to import from `core/types/pane-layout` instead
- Create `extractVisibleThreadIds(state: PaneLayoutPersistedState): Set<string>` in `core/lib/pane-layout.ts` — pure function, no store dependency
- Frontend `getVisibleThreadIds()` in `src/stores/pane-layout/store.ts` becomes a thin wrapper that calls `extractVisibleThreadIds(getState())`
- Agent side imports the same function, feeds it the parsed JSON from disk

#### File watcher instead of TTL cache

Instead of polling with a cached TTL, the agent process uses `fs.watch()` on `pane-layout.json` for instant visibility updates on tab switch. `fs.watch` uses kqueue on macOS — kernel-level, zero-cost when idle, instant notification on write.

**One watcher per agent process.** Each agent process has its own `HubClient`. The watcher lives on the `HubClient` (or a shared singleton within the process). On file change: re-read, re-parse with the shared Zod schema, update the cached `Set<string>` of visible thread IDs. The per-event check is just `visibleThreads.has(threadId)` — O(1).

**Scalability with many threads:** The visible set is bounded by the number of pane groups (typically 1–4 splits), not the number of threads. 100 agents each watching the same file is fine — kqueue handles many watchers on one inode efficiently, and the file only changes on user interaction (tab switch, split), not on agent activity.

#### Flow

1. **Agent process watches `~/.anvil/ui/pane-layout.json`** — `fs.watch()` fires on layout mutations. On change: read file, parse with `PaneLayoutPersistedStateSchema`, extract visible set via `extractVisibleThreadIds()`. Cache the `Set<string>` in memory.

2. **Initial read on HubClient connect** — Parse the file once at startup to populate the initial visible set before any events are sent.

3. **Gate display events** — `sendEvent()` checks: if event is NOT in `LIFECYCLE_EVENTS` and `!visibleThreads.has(this.threadId)`, skip. Lifecycle events always send.

4. **Error = throw** — If the file doesn't exist, is unreadable, or fails Zod parse, throw. The pane layout file is written by the Tauri app on startup and every mutation. If it's missing or corrupt, something is fundamentally broken and we need to know immediately, not silently flood the pipeline.

## Key Files

| File | Role |
|------|------|
| `core/types/pane-layout.ts` | **New.** Pane layout Zod schemas moved from `src/` — `PaneLayoutPersistedStateSchema`, `ContentPaneViewSchema`, etc. |
| `core/lib/pane-layout.ts` | **New.** Pure `extractVisibleThreadIds(state) → Set<string>` |
| `core/types/events.ts` | Add `LIFECYCLE_EVENTS` set — everything not in it is display-gated |
| `src/stores/pane-layout/types.ts` | **Deleted** — all imports updated to `core/types/pane-layout` directly |
| `src/stores/pane-layout/index.ts` | Re-exports updated to point at `core/types/pane-layout` |
| `src/stores/content-panes/types.ts` | `ContentPaneViewSchema` removed (moved to core), keeps `ContentPaneSchema`, `ContentPanesPersistedStateSchema`, `ContentPaneData` — imports `ContentPaneViewSchema` from core for its own use |
| `src/stores/pane-layout/store.ts` | `getVisibleThreadIds()` becomes wrapper around `extractVisibleThreadIds()` |
| `agents/src/lib/hub/client.ts` | `fs.watch` + gating in `sendEvent()` using shared core logic |

### Import Update Map

Files that need their pane-layout type imports updated to `core/types/pane-layout`:

**`src/stores/pane-layout/` internal (relative `./types` → `core/types/pane-layout`):**
- `store.ts` — `PaneLayoutPersistedState`, `PaneGroup`, `TabItem`, `TerminalPanelState`
- `service.ts` — `PaneLayoutPersistedStateSchema`, `PaneLayoutPersistedState`
- `index.ts` — re-exports all schemas and types
- `defaults.ts` — `PaneLayoutPersistedState`, `PaneGroup`, `TabItem`
- `migrations.ts` — `PaneLayoutPersistedState`
- `__tests__/types.test.ts` — `SplitNodeSchema`, `TabItemSchema`, `PaneGroupSchema`, `PaneLayoutPersistedStateSchema`
- `__tests__/store.test.ts` — `PaneGroup`, `TabItem`, `PaneLayoutPersistedState`
- `__tests__/service.test.ts` — `PaneLayoutPersistedState`
- `__tests__/listeners.test.ts` — `PaneLayoutPersistedState`
- `__tests__/defaults.test.ts` — `PaneLayoutPersistedStateSchema`

**`src/components/split-layout/` (aliased `@/stores/pane-layout/types` → `core/types/pane-layout`):**
- `types.ts` — `SplitNode`
- `tab-bar.tsx` — `TabItem`
- `tab-item.tsx` — `TabItem`
- `split-layout.ui.test.tsx` — `SplitNode`, `PaneGroup`
- `tab-bar-new-tab.ui.test.tsx` — `TabItem`
- `__tests__/tab-dnd.test.ts` — `PaneGroup`, `TabItem`, `PaneLayoutPersistedState`
- `__tests__/tab-interactions.test.ts` — `PaneGroup`, `TabItem`, `PaneLayoutPersistedState`

**`src/stores/content-panes/types.ts`:**
- `ContentPaneViewSchema` import updated from local definition to `core/types/pane-layout`

**`src/hooks/__tests__/use-quick-action-hotkeys.test.tsx`:**
- `PaneLayoutPersistedState` from `@/stores/pane-layout/types.js`

## Phases

- [x] Move pane layout Zod schemas to `core/types/pane-layout.ts`, update all imports across `src/` to point directly at `core/` (no re-exports), delete `src/stores/pane-layout/types.ts`
- [x] Create `extractVisibleThreadIds()` in `core/lib/pane-layout.ts`, refactor frontend `getVisibleThreadIds()` to use it
- [x] Define event classification in `core/types/events.ts` — add `LIFECYCLE_EVENTS` set (everything not in it is display-gated)
- [x] Agent-side gating in `hub/client.ts`: `fs.watch` + initial read, parse with shared schema, gate display events via `sendEvent()`, throw on read/parse failure
- [x] Tests: shared extraction logic (various layout shapes), event classification, agent-side gating (visible/non-visible/watcher update/error throw)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design Considerations

**Why shared core logic**: The extraction is a pure function over a Zod-validated shape. Duplicating it in agents would mean two implementations to keep in sync. Moving the schemas and function to `core/` follows the existing type layering (`src/` → `agents/` → `core/`, imports flow inward) and the "disk as truth" pattern.

**Why update imports instead of re-exporting**: Re-exports from the old `src/stores/pane-layout/types.ts` location create an unnecessary indirection layer that obscures where types actually live. With ~18 import sites all in `src/`, updating them is straightforward and makes the dependency graph honest. The old `types.ts` file can be deleted entirely.

**Why `fs.watch` over TTL cache**: A 2s TTL means up to 2s of wasted events after every tab switch — exactly when the user is paying attention. `fs.watch` (kqueue) gives instant updates with zero overhead when the file isn't changing. Simpler code too: no timer, no TTL bookkeeping, just a callback.

**Why throw on failure**: The pane-layout file is written by `persistState()` on every layout mutation and on app init. If it's missing or corrupt, the UI state persistence layer is broken — that's a bug, not a graceful-degradation scenario. Silently flooding events as a "fallback" masks the real problem. Agents are child processes of the Tauri app; the file should always exist.

**Sub-agent events**: Sub-agents have their own threadId but their parent thread may be visible. The agent runner already knows its own threadId — check if it (or its parent) is in the visible set.

**No staleness concern**: Agents are child processes of the Tauri app. If the app crashes, agents die too. The pane-layout.json will reflect whatever the user was last looking at, which is fine — there's no scenario where agents outlive the app and filter based on stale layout.

**Race condition on watch**: `fs.watch` fires, agent reads while frontend may be mid-write. Worst case is a partial read that fails JSON parse — this throws (surfacing the issue), but the watcher stays alive and the next write triggers a clean re-read. To handle this gracefully, the watcher callback can retry once after a short delay (e.g., 50ms) before throwing, giving the write time to complete.

**No Rust changes needed**: Filtering at the agent level (before events enter the hub socket) reduces load on the entire pipeline — hub, broadcast channel, WS, and frontend. The AgentHub remains a simple router.
