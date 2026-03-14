# Visible-Thread Event Filtering

## Problem

The agent→frontend event pipeline floods faster than the frontend can consume. In a 12-minute session: 508 sequence gaps, 1,407 events dropped, broadcast channel (capacity 1024) overflows, frontend frame rate degrades from 19.6 → 0.7 FPS, leading to WebKit network process crash.

Currently, **all** agent events are broadcast to **all** WS clients regardless of which thread the user is viewing. The broadcast channel in `push.rs` is all-or-nothing — no topic filtering.

## Approach

Instead of debouncing, implement a **visibility-aware event gate**: only emit high-frequency "display" events for threads the user is actively viewing. Lifecycle events always emit.

### Event Classification

**Always-emit (lifecycle):** Events that affect global state — thread creation, status changes, agent spawn/complete/error, worktree allocation, plan detection, permission requests, API health, thread naming, etc.

**Visibility-gated (display):** High-frequency events tied to a specific thread's rendering — `STREAM_DELTA`, `THREAD_ACTION` (reducer updates like append_block, update_block, tool_state changes), `QUEUED_MESSAGE_ACK`.

### Architecture: Ephemeral Visibility File with Heartbeat

Visibility is **ephemeral UI state**, not thread metadata. It belongs in a separate short-lived file that the Rust side can read in O(1), with built-in staleness detection to prevent stuck-visible threads.

**Source of truth**: `getVisibleThreadIds()` in `src/stores/pane-layout/store.ts` — iterates all pane groups, collects threadIds from each group's active tab. This already handles multi-pane correctly.

#### Flow

1. **Frontend writes `~/.mort/ui/visible-threads.json`** — Driven by pane layout changes (tab switch, open, close, split), not `setActiveThread()`. Written whenever `getVisibleThreadIds()` output changes.
   ```json
   {
     "windows": {
       "main": ["thread-id-1", "thread-id-2"],
       "window-abc123": ["thread-id-3"]
     },
     "timestamp": 1710000000000
   }
   ```
   - Keyed by window ID (main window + standalone windows from `control-panel-main.tsx`)
   - Each window writes its own key; Rust unions all values to get the full visible set
   - A **heartbeat** re-writes the file every ~3s to keep the timestamp fresh

2. **`beforeunload` cleanup** — On window close, remove that window's key from the file. On clean app shutdown, delete the file entirely.

3. **AgentHub reads the file** — On each incoming display-class event, check the cached visible set. Cache with ~1s TTL (re-read file on expiry).
   - **Staleness check**: If `timestamp` is older than ~10s, treat ALL threads as visible. This handles app crashes — no threads get stuck invisible.
   - Thread is visible if its ID appears in any window's array.

4. **Agent-side skip (optional)** — Agent process reads the same file, skips emitting display events for non-visible threads.

#### Why a Separate Ephemeral File

- **Visibility is UI state, not thread state** — it shouldn't pollute `metadata.json` which is the thread's persistent identity
- **O(1) reads** — Rust reads one small file, not N metadata files
- **No write contention** — agent runner writes `metadata.json`; frontend writes visibility file; no merge conflicts
- **Staleness = automatic cleanup** — if the app crashes, the timestamp goes stale and Rust falls back to "all visible". No stuck threads.
- **Multi-window is natural** — each window owns a key, Rust unions them. Window close removes the key.
- **Already lives in `~/.mort/ui/`** — pane layout is already persisted at `~/.mort/ui/pane-layout.json`, so this is a natural sibling

## Key Files

| File | Role |
|------|------|
| `core/types/events.ts` | Add event classification (`LIFECYCLE_EVENTS` / `DISPLAY_EVENTS` sets) |
| `src/stores/pane-layout/store.ts` | Already has `getVisibleThreadIds()` — hook into changes |
| `src/stores/pane-layout/service.ts` | Write `~/.mort/ui/visible-threads.json` on layout changes + heartbeat |
| `src-tauri/src/agent_hub.rs` | Read visible-threads file, gate display events |
| `src-tauri/src/ws_server/push.rs` | Broadcast channel (unchanged, but load reduced) |
| `agents/src/lib/hub/client.ts` | (Optional) Agent-side skip for display events |

## Phases

- [ ] Define event classification in `core/types/events.ts` — add `LIFECYCLE_EVENTS` and `DISPLAY_EVENTS` sets
- [ ] Frontend: subscribe to pane layout changes, write `~/.mort/ui/visible-threads.json` via `getVisibleThreadIds()` + heartbeat timer
- [ ] Frontend: add `beforeunload` handler to clean up window's visibility key; clean shutdown deletes the file
- [ ] AgentHub: read and cache visible-threads file with TTL, gate display events; treat stale timestamp (>10s) as "all visible"
- [ ] Agent-side: read visible-threads file in hub client, skip emitting display events for non-visible threads
- [ ] Add tests for event classification, visibility file writes, staleness fallback, and AgentHub gating logic

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design Considerations

**Stuck-visible prevention**: The heartbeat timestamp is the key mechanism. If the frontend stops writing (crash, freeze, kill -9), the timestamp goes stale after ~10s and Rust falls back to "all visible". No thread is permanently stuck as invisible or visible. On next app launch, the file is re-created fresh from current pane layout state.

**Race condition on file write/read**: Acceptable — worst case is a few extra events emitted for ~1s until the hub's cache expires. No data loss.

**Multi-window**: Each window writes its own key into the `windows` map. A window's `beforeunload` removes its key. Rust unions all window arrays to get the full visible set. If a window crashes without cleanup, the heartbeat from remaining windows keeps the timestamp fresh; the dead window's stale entries get cleaned up on next write from any surviving window.

**Single-writer coordination**: Multiple windows writing the same file requires read-modify-write. Each window reads the file, updates its own key, writes back. Race window is tiny (< 1ms) and worst case is one window's write overwrites another's — corrected on the next heartbeat cycle (3s). Acceptable for an optimization signal.

**Sub-agent events**: Sub-agents have their own threadId but their parent thread may be visible. The hierarchy map in AgentHub already tracks `parentId` — use it to also pass display events for children of visible threads.

**Fallback**: If the file doesn't exist, is unreadable, or timestamp is stale (>10s), treat ALL threads as visible (no filtering). This ensures backward compatibility and avoids silent event loss.

**Why not thread metadata**: Visibility is ephemeral UI state that changes on every tab switch. Writing it to `metadata.json` creates write contention with the agent runner, requires N file reads to build the visible set, and risks threads getting stuck `visible: true` if the app crashes without cleanup.
